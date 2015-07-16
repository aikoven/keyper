import {
    Collection, IFilterParams, SliceArray, IFetchOptions
} from './collection';
import {Ordering, ICriteria, Criteria} from './query';
import {sortedIndex, isEqual} from './utils';

import * as common from './common';
import {KeyType, Entity, Comparator, ObjectMask} from './common';


export interface ICollectionViewOptions {
    where?:ICriteria,
    orderBy?:string|string[],
    loadImmediately?:boolean,
    fromCache?:boolean,
    fetchOptions?:IFetchOptions,
}


export interface IPaginatedViewOptions extends ICollectionViewOptions {
    pageSize?:number;
}


export class CollectionView {
    items:Entity[];
    loading:boolean = false;

    private _loadingPromise:Promise<any>;

    fromCache:boolean;

    protected query:ICriteria;
    protected orderingCmp:Comparator;
    protected orderBy:string|string[];

    private _fetchOptions:IFetchOptions;

    private _injectedBinding:SignalBinding;
    private _ejectedBinding:SignalBinding;

    protected _pks:Set<KeyType>;

    constructor(private collection:Collection,
                options:ICollectionViewOptions = {}) {
        this._ejectedBinding = collection.ejected.add(this.onEjected, this);
        this._injectedBinding = collection.injected.add(this.onInjected, this);

        this._fetchOptions = options.fetchOptions || {};

        this.setOrderBy(options.orderBy, false);
        this.setQuery(options.where, false);

        this.fromCache = options.fromCache != null ? options.fromCache : false;

        // hack to allow child classes do extra setup in constructors prior to
        // loading
        if (this.constructor.prototype === CollectionView.prototype &&
            (options.loadImmediately == null || options.loadImmediately)) {
            this.load();
        }
    }

    dispose():void {
        this._injectedBinding.detach();
        this._ejectedBinding.detach();
    }

    setQuery(query:ICriteria, reload=true):void {
        if (query == null)
            query = {};

        if (isEqual(query, this.query))
            return;

        this.query = query;

        if (reload)
            this.load();
    }

    setOrderBy(orderBy:string|string[], reload=true):void {
        if (orderBy == null) {
            orderBy = this.collection.config.primaryKey;
        }

        this.orderBy = orderBy;
        this.orderingCmp = Ordering.comparator(orderBy);

        if (reload)
            this.load();
    }

    load(fromCache:boolean = this.fromCache):void {
        this._injectedBinding.active = false;
        this._ejectedBinding.active = false;
        this.loading = true;

        var params = this.getFilterParams();
        let promise:Promise<SliceArray<Entity>>;

        if (fromCache) {
            promise = common.Promise.resolve(
                this.collection.filter(params));

            if (this._fetchOptions.loadRelations) {
                promise = promise.then((items) =>
                    this.collection.loadRelations(items,
                        this._fetchOptions.loadRelations))
            }
        } else {
            promise = this.collection.fetch(params, this._fetchOptions);
        }

        this._loadingPromise = promise =
            promise.then((items:SliceArray<Entity>) => {
                if (promise === this._loadingPromise) {
                    this.onFetched(items);
                }
                return null;
            });

        let _finally = () => {
            if (promise === this._loadingPromise) {
                this.loading = false;
                this._injectedBinding.active = true;
                this._ejectedBinding.active = true;
            }
        };
        promise.then(_finally, _finally)
    }

    protected onFetched(items:SliceArray<Entity>):void {
        this.items = items.slice();

        this._pks = new Set<KeyType>();
        for (let item of items) {
            this._pks.add(item.pk);
        }
    }

    protected getFilterParams():IFilterParams {
        return {
            where: this.query,
            orderBy: this.orderBy,
        }
    }

    protected isFiltered(item:Entity):boolean {
        return Criteria.test(item, this.query);
    }

    private onInjected(item:Entity, previous:Entity):void {
        if (previous != null) {
            this.removeItem(previous);
        }

        // todo: handle case when query contains references to relation fields
        // we need to load relations before checking criteria
        if (this.isFiltered(item)) {
            this.addItem(item);
        }
    }

    private onEjected(item:Entity):void {
        this.removeItem(item);
    }

    protected addItem(item:Entity):void {
        if (this._pks.has(item.pk))
            throw new Error(`Duplicate item with pk=${item.pk}`);

        let promise = common.Promise.resolve(item);

        if (this._fetchOptions.loadRelations) {
            promise = promise.then((item) => {
                return this.collection.loadRelations(item,
                    this._fetchOptions.loadRelations);
            })
        }

        promise.then((item) => {
            let idx = sortedIndex(this.items, item, this.orderingCmp);
            this.items.splice(idx, 0, item);
            this._pks.add(item.pk);
        });
    }

    protected removeItem(item:Entity):void {
        if (this._pks.has(item.pk)) {
            let idx = this.items.indexOf(item);
            this.items.splice(idx, 1);
            this._pks.delete(item.pk);
        }
    }
}


export class PaginatedView extends CollectionView {
    static defaultPageSize = 15;

    pageSize:number;
    currentPage:number;
    total:number;

    constructor(collection:Collection, options:IPaginatedViewOptions = {}) {
        super(collection, options);

        this.pageSize = options.pageSize != null ?
            options.pageSize : PaginatedView.defaultPageSize;

        if (options.loadImmediately == null || options.loadImmediately)
            this.setPage(0);
    }

    protected getFilterParams():IFilterParams {
        return {
            where: this.query,
            orderBy: this.orderBy,
            offset: this.currentPage * this.pageSize,
            limit: this.pageSize,
        }
    }

    setPage(page:number, reload=true) {
        this.currentPage = page;

        if (reload)
            this.load();
    }

    protected onFetched(items:SliceArray<Entity>):void {
        super.onFetched(items);
        this.total = items.total;
    }

    protected addItem(item:Entity):void {
        this.total++;

        if (this.items.length > 0) {
            // if item is below the last item of the list
            if (this.orderingCmp(item,
                    this.items[this.items.length - 1]) > 0) {
                // only add if current page is the last
                if ((this.currentPage + 1) * this.pageSize < this.total)
                    return;
            }

            // if item is above the first item of the list
            if (this.orderingCmp(item, this.items[0]) < 0) {
                // only add if current page is the first
                if (this.currentPage > 0)
                    return;
            }
        }

        super.addItem(item);
    }

    protected removeItem(item:Entity):void {
        if (this.isFiltered(item)) {
            this.total--;
        }
        super.removeItem(item);
    }
}


export class LoadMoreView extends CollectionView {
    static defaultPageSize = 15;

    pageSize:number;
    currentPage:number;
    total:number;

    constructor(collection:Collection, options:IPaginatedViewOptions = {}) {
        super(collection, options);

        this.pageSize = options.pageSize != null ?
            options.pageSize : LoadMoreView.defaultPageSize;

        if (options.loadImmediately == null || options.loadImmediately)
            this.loadMore();
    }

    protected getFilterParams():IFilterParams {
        return {
            where: this.query,
            orderBy: this.orderBy,
            offset: this.currentPage * this.pageSize,
            limit: this.pageSize,
        }
    }

    private _reset():void {
        this.currentPage = null;
        this.items = null;
        this._pks = null;
    }

    setQuery(query:ICriteria, reload = true):void {
        super.setQuery(query, false);

        if (reload) {
            this._reset();
            this.loadMore();
        }
    }

    setOrderBy(orderBy:any, reload = true):void {
        super.setOrderBy(orderBy, false);

        if (reload) {
            this._reset();
            this.loadMore();
        }
    }

    loadMore():void {
        this.currentPage = this.currentPage == null ? 0 : this.currentPage + 1;

        this.load();
    }

    protected onFetched(items:SliceArray<Entity>):void {
        this.total = items.total;

        if (this.items == null) {
            this.items = []
        }

        if (this._pks == null) {
            this._pks = new Set<KeyType>();
        }
        for (let item of items) {
            if (!this._pks.has(item.pk)) {
                let idx = sortedIndex(this.items, item, this.orderingCmp);
                this.items.splice(idx, 0, item);
                this._pks.add(item.pk);
            }
        }
    }

    protected addItem(item:Entity):void {
        this.total++;

        if (this.items.length > 0) {
            // if item is below the last item of the list
            if (this.orderingCmp(item, this.items[this.items.length-1]) > 0) {
                // only add if current page is the last
                if ((this.currentPage+1) * this.pageSize < this.total)
                    return;
            }
        }

        super.addItem(item);
    }

    protected removeItem(item:Entity):void {
        if (this.isFiltered(item)) {
            this.total--;
        }
        super.removeItem(item);
    }
}