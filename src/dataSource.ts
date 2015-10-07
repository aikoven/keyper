import {KeyType, SliceArray, ObjectMask} from './common';
import {ICriteria} from './query';
import {Collection} from "./collection";


export interface IFilterParams {
    where?: ICriteria;
    orderBy?: string|string[];
    limit?: number;
    offset?: number;
}


export type DataSourceConstructor<
    Config extends IDataSourceConfig, Options extends IDataSourceOptions> ={

    new (collection:Collection, config?:Config):IDataSource<Config, Options>;
}


export interface IDataSourceConfig {

}


export interface IDataSourceOptions {

}


/**
 * Data Source is used by [[Collection]] to retrieve and save
 * [[Entity|Entities]].
 */
export interface IDataSource<
    Config extends IDataSourceConfig,
    Options extends IDataSourceOptions
    > {

    config:Config;

    findOne(pk:KeyType, options?:Options):Promise<any>;
    find(params:IFilterParams, options?:Options):Promise<SliceArray<any>>;
    findAll(pks:KeyType[], options?:Options):Promise<any[]>;

    update(pk:KeyType, item:Object, options?:Options):Promise<any>;
    create(item:Object, options?:Options):Promise<any>;
    delete(pk:KeyType, options?:Options):Promise<any>;
}