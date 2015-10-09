/**
 * View is a live subset of [[Collection]] items that updates automatically
 * when items in Collection are added, changed or removed.
 *
 * There are currently three types of views: [[CollectionView]],
 * [[PaginatedView]] and [[LoadMoreView]].
 */

/** #guard for module doc comment# */
import {IFilterParams, IDataSourceOptions} from './dataSource';
import {Collection, IFetchOptions} from './collection';
import {Ordering, ICriteria, Criteria} from './query';
import {sortedIndex, isEqual, always} from './utils';

import common from './common';
import {KeyType, Entity, Comparator, ObjectMask, SliceArray} from './common';


export interface ICollectionViewOptions {
    where?:ICriteria;
    orderBy?:string|string[];

    /**
     * If `true`, items will be fetched immediately after construction of
     * [[CollectionView]].
     *
     * Default is `true`.
     */
    loadImmediately?:boolean;

    /**
     * If `true`, items will be loaded from [[Collection]] cache instead of
     * loading from [[IDataSource|Data Source]].
     *
     * Default is `false`.
     */
    fromCache?:boolean;

    /**
     * Extra options that will be passed to
     * [[Collection.fetch|Collection.fetch]].
     */
    fetchOptions?:IFetchOptions & IDataSourceOptions;
}


export interface IPaginatedViewOptions extends ICollectionViewOptions {
    pageSize?:number;
}


/**
 * Represents subset of collection items filtered by [[ICriteria|query]].
 */
export class CollectionView {
    /**
     * View items that are updated automatically. Don't mutate this array
     * from outside.
     */
    items:Entity[];

    /**
     * Indicates that items are currently being fetched.
     */
    loading:boolean = false;

    fromCache:boolean;

    query:ICriteria;
    protected orderingCmp:Comparator;
    orderBy:string|string[];

    private _fetchOptions:IFetchOptions;

    private _insertedBinding:SignalBinding;
    private _removedBinding:SignalBinding;

    protected _pks:Set<KeyType>;

    private _loadingPromise:Promise<void>;
    private _itemLoadingPromises:{[pk:string]: Promise<void>} = {};

    constructor(public collection:Collection,
                options:ICollectionViewOptions = {}) {
        this._removedBinding = collection.removed.add(this.onEjected, this);
        this._insertedBinding = collection.inserted.add(this.onInjected, this);

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

    /**
     * Detach bindings to collection inserted/removed signals.
     */
    dispose():void {
        this._insertedBinding.detach();
        this._removedBinding.detach();
    }

    /**
     * Set `where` query.
     *
     * @param query
     * @param reload If `true`, reloads items with new query.
     *  Default is `true`.
     */
    setQuery(query:ICriteria, reload=true):void {
        if (query == null)
            query = {};

        if (isEqual(query, this.query))
            return;

        this.query = query;

        if (reload)
            this.load();
    }

    /**
     * Set items order.
     *
     * @param orderBy
     * @param reload If `true`, reloads items with new order.
     *  Default is `true`.
     */
    setOrderBy(orderBy:string|string[], reload=true):void {
        if (orderBy == null) {
            orderBy = this.collection.config.primaryKey;
        }

        this.orderBy = orderBy;
        this.orderingCmp = Ordering.comparator(orderBy);

        if (reload)
            this.load();
    }

    /**
     * Performs [[Collection.fetch]] when `fromCache` is `false` and
     * [[Collection.filter]] otherwise.
     *
     * @param fromCache Whether to load from Collection cache or DataSource.
     *  Default value is taken from [[ICollectionViewOptions]].
     */
    load(fromCache:boolean = this.fromCache):Promise<void> {
        this._insertedBinding.active = false;
        this._removedBinding.active = false;
        this.loading = true;

        var params = this.getFilterParams();
        let fetchPromise:Promise<SliceArray<Entity>>;

        if (fromCache) {
            fetchPromise = this.collection.loadRelations(
                this.collection.filter(params),
                this._fetchOptions.loadRelations
            );
        } else {
            fetchPromise = this.collection.fetch(params, this._fetchOptions);
        }

        let loadingPromise:Promise<void>;
        loadingPromise = this._loadingPromise =
            fetchPromise.then((items:SliceArray<Entity>) => {
                if (loadingPromise === this._loadingPromise) {
                    this.onFetched(items);
                }
            });

        always(loadingPromise, () => {
            if (loadingPromise === this._loadingPromise) {
                this.loading = false;
                this._loadingPromise = null;
                this._insertedBinding.active = true;
                this._removedBinding.active = true;
            }
        });

        return loadingPromise;
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

        let promise = this.collection.loadRelations(item,
            this._fetchOptions.loadRelations);

        let stringPk = item.pk.toString();
        let itemPromise:Promise<void>;
        itemPromise = this._itemLoadingPromises[stringPk] =
            promise.then((item) => {
                if (itemPromise === this._itemLoadingPromises[stringPk]) {
                    delete this._itemLoadingPromises[stringPk];
                    let idx = sortedIndex(this.items, item, this.orderingCmp);
                    this.items.splice(idx, 0, item);
                    this._pks.add(item.pk);
                }
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

    /**
     * Set current page.
     *
     * @param page 0-indexed page number.
     * @param reload If `true`, reloads items with new query.
     *  Default is `true`.
     */
    setPage(page:number, reload=true) {
        this.currentPage = page;

        if (reload)
            this.load();
    }

    setQuery(query:ICriteria, reload = true):void {
        this.currentPage = 0;
        super.setQuery(query, reload);
    }

    setOrderBy(orderBy:any, reload = true):void {
        this.currentPage = 0;
        super.setOrderBy(orderBy, reload);
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

    /**
     * Load more items.
     */
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
