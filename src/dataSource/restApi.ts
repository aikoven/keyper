import {
    IDataSource, IFilterParams,
    IDataSourceOptions, ICommitOptions, IFetchOptions
} from '../dataSource';
import {Collection, ICollectionConfig, IBackRefConfig} from '../collection';

import * as common from '../common';
import {KeyType, SliceArray} from '../common';


function getField(object:Object, field:string) {
    let ret = object;

    for (let item of field.split('.')) {
        if (ret == null)
            break;
        ret = ret[item];
    }

    return ret;
}


let endpointParamRegexp = /:[^/]+/g;

let stripSlashRegexp = /^\/|\/$/g;

function joinPathComponents(...components:string[]) {
    let path = [];
    for (let component of components) {
        if (!component)
            continue;

        path.push(`${component}`.replace(stripSlashRegexp, ''));
    }
    return path.join('/');
}


export interface IRestApiDataSourceConfig extends ICollectionConfig {
    basePath?: string;
    endpoint?: string|((Object?) => string);
    endpointId?: string;
}


export interface IRestApiDataSourceOptions extends IDataSourceOptions {
    endpointParams?: Object,
}

export interface IRestApiCommitOptions
extends IRestApiDataSourceOptions, ICommitOptions {
}

export interface IRestApiFetchOptions
extends IRestApiDataSourceOptions, IFetchOptions {
}


export class AbstractRestApiDataSource implements IDataSource {
    config:IRestApiDataSourceConfig;
    protected getEndpoint: (Object?) => string;

    constructor(protected collection:Collection) {
        this.config = collection.config;
        if (typeof this.config.endpoint === 'function') {
            this.getEndpoint = <(Object?) => string>this.config.endpoint;
        } else {
            if ((<string>this.config.endpoint).charAt(0) === '@') {
                // concatenate with parent endpoint
                if (collection.config.parent == null) {
                    throw new Error(`Invalid use of @-prefix in endpoint for `+
                        `collection without parent`)
                }

                let parentField = collection.config.parent;
                let parentRelation = collection.relations.get(parentField);
                let parentCollection:Collection =
                    collection.db.getCollection(parentRelation.collection);

                let parentConfig:IRestApiDataSourceConfig =
                    parentCollection.config;

                if (typeof parentConfig.endpoint !== 'string') {
                    throw new Error(`Can't use @-prefix to concatenate with `+
                        `parent endpoint specified as a function`)
                }

                let parentEndpoint:string = <string>parentConfig.endpoint;

                this.config.endpoint = joinPathComponents(
                    parentEndpoint.replace(endpointParamRegexp,
                        (match:string) => {
                            return `:${parentField}.${match.substr(1)}`;
                        }),
                    `:${parentRelation.foreignKey}`,
                    (<string>this.config.endpoint).substr(1)
                );
            }

            let endpoint:string = <string>this.config.endpoint;

            if (endpoint.search(endpointParamRegexp)) {
                this.getEndpoint = (params:Object) => {
                    return this.interpolateEndpoint(endpoint, params);
                }
            } else {
                this.getEndpoint = () => endpoint;
            }
        }
    }

    private interpolateEndpoint(endpoint:string, params:Object) {
        return endpoint.replace(endpointParamRegexp, (match:string) => {
            let field = getField(params, match.substr(1));
            if (field == null)
                throw new Error(
                    `Could not interpolate endpoint string '${endpoint}'
                    with params ${JSON.stringify(params)}`
                );
            return <string>field;
        });
    }

    protected getUrl(params:Object, pk?:KeyType) {
        let id;


        if (pk != null) {
            if (this.config.primaryKey instanceof Array) {
                if (this.config.endpointId == null)
                    throw new Error(`endpointId must be specified for
                    collections with compound primary key`);

                if (typeof pk === 'string') {
                    pk = (<string>pk).split(',');
                }

                let pkParams = {};

                for (let i=0, len=this.config.primaryKey.length; i<len; i++) {
                    let pkComponent = this.config.primaryKey[i];

                    if (pkComponent === this.config.endpointId) {
                        id = pk[i];
                    } else {
                        pkParams[pkComponent] = pk[i];
                    }
                }

                params = Object.assign(pkParams, params);
            } else {
                id = pk;
            }
        }

        return joinPathComponents(
            this.config.basePath,
            this.getEndpoint(params),
            id
        );
    }

    protected createFindAllParams(pks:KeyType[]):IFilterParams {
        throw new Error('Not implemented')
    }

    protected makeRequest(methodName:string, url:string,
                          params:any, payload:any) {
        throw new Error('Not implemented')
    }

    protected deserialize(methodName:string, response:any):any {
        return response.data;
    }

    protected serialize(payload:Object):any {
        let ret = {};

        for (let prop in payload) {
            if (!payload.hasOwnProperty(prop))
                continue;

            let backRefConfig:IBackRefConfig =
                this.collection.backRefs.get(prop);

            if (backRefConfig != null) {
                let backRefCollection =
                    this.collection.db.getCollection(backRefConfig.collection);
                let backRefSource =
                    <AbstractRestApiDataSource>backRefCollection.source;

                if (!(backRefSource instanceof AbstractRestApiDataSource)) {
                    throw new Error(`Can't serialize backRef field ${prop} `+
                        `for ${this.collection.name}: related collection `+
                        `has different Data Source`);
                }

                ret[prop] = payload[prop].map((backRefItem) =>
                    backRefSource.serialize(backRefItem));
            } else {
                ret[prop] = payload[prop];
            }
        }

        return payload;
    }

    protected getTotalCount(response:any):number {
        throw new Error('not implemented')
    }

    private _request(methodName:string, url:string,
                     params?:IFilterParams, payload?:any):Promise<any> {
        if (payload != null) {
            payload = this.serialize(payload);
        }

        return common.Promise.resolve(
            this.makeRequest(methodName, url, params, payload)
        ).then((response) => {
            let ret = this.deserialize(methodName, response);

            if (methodName === 'find' && !('total' in ret)) {
                // lazy property getter
                Object.defineProperty(ret, 'total', {
                    get: () => {
                        let total = this.getTotalCount(response);
                        Object.defineProperty(ret, 'total', {value: total});
                        return total;
                    }
                });
            }

            return ret;
        });
    }

    findOne(pk:KeyType, options:IRestApiFetchOptions = {}):Promise<any> {
        if (pk == null) {
            throw new Error(`Missing primary key`);
        }
        let url = this.getUrl(options.endpointParams, pk);
        return this._request('findOne', url);
    }

    find(params:IFilterParams, options:IRestApiFetchOptions = {})
    :Promise<SliceArray<any>> {
        let url = this.getUrl(options.endpointParams || params.where);
        return this._request('find', url, params);
    }

    findAll(pks:KeyType[], options:IRestApiFetchOptions = {})
    :Promise<any[]> {
        return this.find(this.createFindAllParams(pks), options);
    }

    update(pk:KeyType, item:Object, options:IRestApiCommitOptions = {})
    :Promise<any> {
        let endpointParams = options.endpointParams ||
            this.collection.index.get(pk) || item;
        let url = this.getUrl(endpointParams, pk);
        return this._request('update', url, null, item);
    }

    create(item:Object, options:IRestApiCommitOptions = {}):Promise<any> {
        let url = this.getUrl(options.endpointParams || item);
        return this._request('create', url, null, item);
    }

    delete(pk:KeyType, options:IRestApiDataSourceOptions = {}):Promise<any> {
        let endpointParams = options.endpointParams ||
            this.collection.index.get(pk);
        let url = this.getUrl(endpointParams, pk);
        return this._request('delete', url);
    }
}
