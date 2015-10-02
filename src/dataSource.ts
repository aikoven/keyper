import {KeyType, SliceArray, ObjectMask} from './common';
import {ICriteria} from './query';


export interface IFilterParams {
    where?: ICriteria;
    orderBy?: string|string[];
    limit?: number;
    offset?: number;
}


export interface IDataSourceOptions {

}


export interface IFetchOptions extends IDataSourceOptions {
    /**
     * If `true`, always make a request to Data Source even if requested
     * item(s) are already in index or cache.
     */
    forceLoad?: boolean;

    /**
     * If specified, then fetched item(s) will be passed to
     * [[Collection.loadRelations]].
     */
    loadRelations?: ObjectMask;
}


export interface ICommitOptions extends IDataSourceOptions {
    /**
     * If true, then only diff will be committed to Data Source.
     * Diff is calculated using [[Collection.getDiff]].
     */
    diff?: boolean;

    /**
     * If true, then passed item will be updated with new values from
     * Data Source response.
     */
    inplace?: boolean;
}


/**
 * Data Source is used by [[Collection]] to retrieve and save
 * [[Entity|Entities]].
 */
export interface IDataSource {
    findOne(pk:KeyType, options?:IDataSourceOptions):Promise<any>;
    find(params:IFilterParams, options?:IFetchOptions)
        :Promise<SliceArray<any>>;
    findAll(pks:KeyType[], options?:IDataSourceOptions):Promise<any[]>;

    update(pk:KeyType, item:Object, options?:ICommitOptions):Promise<any>;
    create(item:Object, options?:ICommitOptions):Promise<any>;
    delete(pk:KeyType, options?:IDataSourceOptions):Promise<any>;
}