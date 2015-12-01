import {KeyType, SliceArray} from '../src/common';
import {Criteria, Ordering} from '../src/query';
import {
    IDataSource, IDataSourceConfig,
    IDataSourceOptions, IFilterParams
} from '../src/dataSource';

import {Collection} from '../src/collection';
import {deepAssign} from '../src/utils';


export function pause(timeout:number = 0) {
    return new Promise((resolve) => {
        setTimeout(resolve, timeout);
    });
}


function remove<T>(array:T[], value:T):void {
    let ind = array.indexOf(value);
    if (ind === -1)
        throw new Error('No such element in array');

    array.splice(ind, 1);
}


export interface PendingRequest {
    respond():void;
    interrupt():void;
}


/**
 * Simple data source backed by array with manual control over promise
 * resolution
 */
export class TestDataSource implements IDataSource<IDataSourceConfig, IDataSourceOptions> {
    data:any[];
    pendingRequests:PendingRequest[] = [];
    private lastId = -1;

    constructor(private collection:Collection, public config?:IDataSourceConfig) {

    }

    setData(data:any[], autoId=true) {
        this.data = [];

        for (let item of data) {
            if (autoId) {
                item[<string>this.collection.config.primaryKey] = ++this.lastId;
            }
            this.data.push(item);
        }
    }

    private getPk(item):KeyType {
        let primaryKey = this.collection.config.primaryKey;

        if (typeof primaryKey === 'string') {
            return item[primaryKey];
        } else {
            let pk = [];
            for (let field of <string[]>primaryKey) {
                if (item[field] == null)
                    return null;

                pk.push(item[field]);
            }
            Object.freeze(pk);
            return pk;
        }
    }

    private delayResponse<T>(getter:() => T):Promise<T> {
        return new Promise((resolve, reject) => {
            let queue = this.pendingRequests;
            queue.push({
                respond: function() {
                    remove(queue, this);
                    try {
                        resolve(getter());
                    } catch (e) {
                        reject(e);
                    }
                },
                interrupt: function() {
                    remove(queue, this);
                    reject();
                }
            });
        });
    }

    runAndRespond<T>(func:() => T) {
        let alreadyPending = this.pendingRequests.slice();
        let result = func();
        for (let request of this.pendingRequests) {
            if (alreadyPending.indexOf(request) === -1) {
                request.respond();
            }
        }
        return result;
    }

    findOne(pk:KeyType, options:IDataSourceOptions):Promise<any> {
        return this.delayResponse(() => {
            let item = this.data.find((it) => this.getPk(it) === pk);
            if (item == null)
                throw new Error(`No item with pk=${pk}`);
            return item;
        });
    }

    find(params:IFilterParams, options:IDataSourceOptions):Promise<SliceArray<any>> {
        return this.delayResponse(() => {
            let items:SliceArray<any>;
            if (params.where == null) {
                items = this.data.slice();
            } else {
                items = this.data.filter(Criteria.tester(params.where));
            }

            if (params.orderBy != null) {
                items.sort(Ordering.comparator(params.orderBy));
            }

            if (params.offset != null) {
                items = items.slice(params.offset);
            }

            if (params.limit != null) {
                items = items.slice(0, params.limit);
            }

            items.total = this.data.length;

            return items;
        });
    }

    findAll(pks:KeyType[], options:IDataSourceOptions):Promise<any[]> {
        pks = pks.slice();

        return this.delayResponse(() => {
            let items = this.data.filter((item) => {
                var pk = this.getPk(item);
                if (pks.indexOf(pk) !== -1) {
                    remove(pks, pk);
                    return true;
                }
                return false;
            });
            if (pks.length > 0)
                throw new Error(`No items with pks=[${pks}]`);

            return items;
        });
    }

    update(pk:KeyType, item:Object, options:IDataSourceOptions):Promise<any> {
        return this.delayResponse(() => {
            let oldItemInd = this.data.findIndex((it) => this.getPk(it) === pk);
            if (oldItemInd === -1)
                throw new Error(`No item with pk=${pk}`);

            let newItem = deepAssign(this.data[oldItemInd], item);
            this.data[oldItemInd] = newItem;
            return newItem;
        });
    }

    create(item:Object, options:IDataSourceOptions):Promise<any> {
        return this.delayResponse(() => {
            let newItem = deepAssign({}, item);
            newItem[<string>this.collection.config.primaryKey] = ++this.lastId;
            this.data.push(newItem);
            return newItem;
        });
    }

    delete(pk:KeyType, options:IDataSourceOptions):Promise<any> {
        return this.delayResponse(() => {
            let oldItemInd = this.data.findIndex((it) => this.getPk(it) === pk);
            if (oldItemInd === -1)
                throw new Error(`No item with pk=${pk}`);

            let oldItem = this.data[oldItemInd];
            this.data.splice(oldItemInd, 1);
            return oldItem;
        });
    }

}
