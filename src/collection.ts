import Signal from 'signals';
import stringify from 'json-stable-stringify';
import {UniqueIndex} from './uniqueIndex';
import {ICriteria, Criteria, Ordering} from './query';
import {
    sortedIndex, deepFreeze, deepAssign, isObjectEmpty,
    objectValues, isEqual, always
} from './utils';

import common from './common';
import {KeyType, Entity, SliceArray, ObjectMask} from './common';
import {
    IDataSource, IFilterParams, IDataSourceOptions, IDataSourceConfig,
    DataSourceConstructor
} from './dataSource';
import {DB} from './db';


export interface IRelationConfig {
    /** Related collection name. */
    collection: string,

    /**
     * True for m2m relation for which foreign key field is array of ids.
     * Default is `false`.
     */
    many?:boolean,

    /**
     * Foreign key field.
     * Default is produced by [[Collection.getDefaultForeignKey]].
     */
    foreignKey?: string,

    /**
     * If specified, then backRef field with that name is added to related
     * collection's [[Collection.itemPrototype]].
     */
    backRef?: string,

    /**
     * If `true`, this relation will be loaded automatically.
     */
    eagerLoad?:boolean;
}


export interface IBackRefConfig {
    /** Related collection name. */
    collection: string,

    /** Foreign key of related collection to this one. */
    foreignKey: string,
}


export interface ICollectionConfig {
    /** Primary key field(s) */
    primaryKey?: string|string[];
    sourceClass?: DataSourceConstructor<any, any>;

    beforeSend?: (Object) => Object;
    beforeInsert?: (Object) => Object;

    /** Parent collection name */
    parent?:string;

    /**
     * Relations config. Keys are relation fields that will be added to
     * collection item prototype.
     * String values are equivalent to `{collection: <value>}`.
     */
    relations?: {[key:string]: IRelationConfig|string};

    /**
     * Object that will be used as prototype for all collection items.
     * A good place for custom properties and methods.
     */
    itemPrototype?: any;
}


export interface IFetchOptions {
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


export interface ICommitOptions {
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


type NonUniqueIndex = {[fk:string]: UniqueIndex};

const EMPTY_INDEX = UniqueIndex();


interface ICachedQuery {
    where: ICriteria;
    items: UniqueIndex;
}

/**
 * Used to get collection name from collection item.
 */
export let COLLECTION_NAME = Symbol('collection name');
let MUTABLE_ITEM_RELATIONS = Symbol('mutable item relations');


/**
 * Collection stores [[Entity|Entities]] and uses [[IDataSource|Data Source]]
 * to retrieve and save them.
 */
export class Collection {
    // signals

    /**
     * Signal that is dispatched every time a new item is inserted into
     * collection. Dispatch params are newly inserted item and old replaced
     * item.
     */
    inserted = new Signal();

    /**
     * Signal that is dispatched when item was removed from collection.
     * Not dispatched for replaced items.
     */
    removed = new Signal();

    /** Name of the collection. */
    name:string;

    /** Collection config. */
    config:ICollectionConfig;

    /** Database this collection belongs to. */
    db:DB<Collection>;

    /** Main collection index */
    index:UniqueIndex = UniqueIndex();

    /**
     * Maps field name to index by this field.
     * Each index maps field value to collection of objects keyed by pk.
     */
    private indexes = new Map<string, NonUniqueIndex>();

    /**
     * Maps serialized [[fetch]] params to results of completed [[fetch]]
     * calls.
     */
    private queries = new Map<string, ICachedQuery>();

    /**
     * Maps serialized filter params to pending [[fetch]] calls.
     */
    private pendingRequests = new Map<string, Promise<SliceArray<Entity>>>();

    /**
     * Maps keys to promises that upon resolution will put corresponding item
     * to the store
     *
     * TODO: replace with object for correct handling of compound keys
     */
    private pendingItemRequests = new Map<KeyType, Promise<any>>();

    /**
     * Data Source for this collection.
     */
    source:IDataSource<any, any>;
    private itemPrototype;

    /** Maps relation fields to relation configs */
    relations = new Map<string, IRelationConfig>();

    /** Maps backRef fields to backRef configs */
    backRefs = new Map<string, IBackRefConfig>();

    /**
     * Map foreign key field to relation field.
     */
    foreignKeys = new Map<string, string>();

    /** Array of child collections */
    childCollections:string[] = [];

    /** Arbitrary data that will not ever be touched by Keyper */
    meta:any = {};

    constructor(db:DB<Collection>, name:string,
                config:ICollectionConfig & IDataSourceConfig) {
        this.db = db;
        this.name = name;
        this.config = config;

        this.itemPrototype = Object.create(config.itemPrototype);
        this.itemPrototype[COLLECTION_NAME] = name;

        // relations
        for (let field in config.relations) {
            if (!config.relations.hasOwnProperty(field))
                continue;

            let value:IRelationConfig|string = config.relations[field];

            let relationField = field;
            let relationConfig:IRelationConfig =
                typeof value === 'string' ? {collection: value} : value;

            if (this.db.collections.has(relationConfig.collection)) {
                this.addRelation(relationField, relationConfig);
            } else {
                // defer adding relation until related collection is created
                let signalBinding:SignalBinding;
                signalBinding = this.db.collectionCreated.add(
                    (collection:Collection) => {
                        if (collection.name === relationConfig.collection) {
                            this.addRelation(relationField, relationConfig);
                            signalBinding.detach();
                        }
                    }
                )
            }
        }

        // parent resource
        if (this.config.parent != null) {
            let relation:IRelationConfig =
                this.relations.get(this.config.parent);

            if (relation == null) {
                throw new Error(`'parent' is defined without corresponding ` +
                    `relation`)
            }

            let parentCollection = this.db.getCollection(relation.collection);
            parentCollection.childCollections.push(this.name);
        }

        this.source = new config.sourceClass(this, config);
    }

    /**
     * Removes all items from collection.
     */
    clear() {
        this.index = UniqueIndex();
        for (let field of this.indexes.keys()) {
            this.indexes.set(field, Object.create(null));
        }
        this.queries = new Map<string, ICachedQuery>();
        // todo: handle pendingRequests
    }

    protected getDefaultForeignKey(field:string, relatedCollection:Collection,
                                   many:boolean):string {
        let relatedCollectionPk = relatedCollection.config.primaryKey;

        if (typeof relatedCollectionPk !== 'string') {
            throw new Error(`Can't create default foreign key for relation ` +
                `'${field}': related collection has compound primary key`);
        }

        return many ?
            `${field}_${relatedCollectionPk}s` :
            `${field}_${relatedCollectionPk}`;
    }

    private addRelation(field:string, config:IRelationConfig):void {
        let relatedCollection = this.db.getCollection(config.collection);

        if (config.foreignKey == null) {
            config.foreignKey = this.getDefaultForeignKey(field,
                relatedCollection, !!config.many);
        }

        if (field in this.itemPrototype) {
            throw new Error(`Can't add relation ${field} to ${this.name}: ` +
                `property exists`)
        }

        this.relations.set(field, config);
        this.foreignKeys.set(config.foreignKey, field);

        let self = this;

        if (config.many) {
            Object.defineProperty(this.itemPrototype, field, {
                get: function relationGetter():Entity[] {
                    let keys:KeyType[] = this[config.foreignKey];

                    try {
                        return keys == null ? null :
                            keys.map((key) => relatedCollection.get(key));
                    } catch (e) {
                        throw new Error(`Could not get relation `+
                            `'${self.name}.${field}': ${e.message}`);
                    }
                },
                set: function() {
                    throw new Error(`Relation fields are read-only`);
                }
            });
        } else {
            Object.defineProperty(this.itemPrototype, field, {
                get: function relationGetter():Entity {
                    let key = this[config.foreignKey];

                    try {
                        return key == null ? null : relatedCollection.get(key);
                    } catch (e) {
                        throw new Error(`Could not get relation `+
                            `'${self.name}.${field}': ${e.message}`);
                    }
                },
                set: function() {
                    throw new Error(`Relation fields are read-only`);
                }
            });
        }

        // setup backRef
        let backRef = config.backRef;

        if (backRef != null) {
            if (backRef in relatedCollection.itemPrototype) {
                throw new Error(`Can't add backref ${backRef} to ` +
                    `${relatedCollection.name}: property exists`)
            }

            relatedCollection.backRefs.set(backRef, {
                collection: this.name,
                foreignKey: config.foreignKey,
            });

            this.addIndex(config.foreignKey);

            Object.defineProperty(relatedCollection.itemPrototype, backRef, {
                get: function backRefGetter():UniqueIndex {
                    let key = this.pk;
                    if (key == null)
                        return EMPTY_INDEX;

                    let backRef = self.indexes.get(config.foreignKey)[key];
                    return backRef == null ? EMPTY_INDEX : backRef;
                },
                set: function() {
                    throw new Error(`BackRef fields are read-only`);
                }
            });
        }
    }

    private getPk(item:Object):KeyType {
        let primaryKey = this.config.primaryKey;

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

    /**
     * Adds non-unique field index.
     */
    private addIndex(field:string):void {
        if (this.indexes.has(field)) {
            return;
        }

        let index:NonUniqueIndex = Object.create(null);

        let item:Entity, fk:KeyType;

        for (item of this.index) {
            fk = item[field];
            if (fk == null)
                continue;

            let items:UniqueIndex = index[fk.toString()];

            if (items == null) {
                index[fk.toString()] = items = UniqueIndex(false);
            }

            items.add(item);
        }

        // make index values immutable
        for (let fk in index) {
            index[fk.toString()].freeze();
        }

        this.indexes.set(field, index);
    }

    private insertArray(items:Entity[]):Entity[] {
        // modify array inplace to keep metadata
        for (let i = 0, len = items.length; i < len; i++) {
            items[i] = this.insert(items[i]);
        }
        return items;
    }

    private insert(item):Entity {
        item = this.config.beforeInsert(item);

        let pk:KeyType = this.getPk(item);

        if (pk == null) {
            throw new Error(`Missing primary key`);
        }

        let field:string,
            relationConfig:IRelationConfig,
            backRefConfig:IBackRefConfig;

        // insert embedded relations
        for ([field, relationConfig] of this.relations) {
            if (item[field] != null) {
                let relatedCollection:Collection =
                    this.db.getCollection(relationConfig.collection);

                let embeddedItem = item[field];
                delete item[field];

                relatedCollection.insert(embeddedItem);
            }
        }

        for ([field, backRefConfig] of this.backRefs) {
            if (item[field] != null) {
                if (!(item[field] instanceof Array)) {
                    throw new Error(`BackRef field ${field} can only ` +
                        `contain array`)
                }

                let relatedCollection:Collection =
                    this.db.getCollection(backRefConfig.collection);

                let embeddedItems:any[] = item[field];
                delete item[field];

                let oldBackRef:UniqueIndex = relatedCollection.indexes
                    .get(backRefConfig.foreignKey)[pk.toString()];

                if (oldBackRef == null) {
                    oldBackRef = UniqueIndex();
                } else {
                    oldBackRef = oldBackRef.copy();
                }

                for (let embeddedItem of embeddedItems) {
                    let inserted = relatedCollection.insert(embeddedItem);
                    oldBackRef.remove(inserted.pk);
                }

                for (let missingItem of oldBackRef) {
                    relatedCollection.remove(missingItem);
                }
            }
        }

        // create cached item
        let cacheItem = this.createInstance(item);

        let previous:Entity = this.index.get(pk);

        if (previous != null) {
            if (isEqual(previous, cacheItem)) {
                return previous;
            }

            this.remove(previous, false);
        }

        // make cache item immutable
        deepFreeze(cacheItem);

        // put to indexes
        this.index = this.index.add(cacheItem);

        for (let [field, index] of this.indexes) {
            let fk:KeyType = cacheItem[field];
            if (fk == null)
                continue;

            let strFk = fk.toString();

            index[strFk] = (index[strFk] || UniqueIndex()).add(cacheItem);
        }

        // update cached queries
        let cached:ICachedQuery;
        for (cached of this.queries.values()) {
            if (Criteria.test(cacheItem, cached.where)) {
                cached.items.add(cacheItem);
            }
        }

        this.inserted.dispatch(cacheItem, previous);

        return cacheItem;
    }

    private remove(item:Entity, notify:boolean=true):void {
        let pk:KeyType = item.pk;

        if (pk == null) {
            throw new Error(`Missing primary key`);
        }

        // remove from indexes

        this.index = this.index.remove(pk);

        let field:string, index:NonUniqueIndex;
        for ([field, index] of this.indexes) {
            let fk:KeyType = item[field];

            if (fk == null)
                continue;

            let strFk = fk.toString();
            let items:UniqueIndex = index[strFk];
            if (items == null)
                continue;

            items = items.remove(pk);

            if (items.length === 0) {
                delete index[strFk];
            } else {
                index[strFk] = items;
            }
        }

        // invalidate cached queries
        for (let [queryHash, cached] of this.queries) {
            if (cached.items.has(pk)) {
                this.queries.delete(queryHash);
            }
        }

        if (notify)
            this.removed.dispatch(item);
    }

    /**
     * Create mutable instance with item prototype.
     *
     * @param item initial values.
     * @returns mutable instance.
     */
    createInstance(item?:Object):Entity {
        let instance = Object.create(this.itemPrototype);
        if (item != null) {
            deepAssign(instance, item);
        }

        Object.defineProperty(instance, 'pk', {
            configurable: false,
            value: this.getPk(instance),
            writable: false,
        });

        return instance;
    }

    /**
     * Retrieves item from collection.
     *
     * @throws Throws error when there is no item with given pk in collection.
     * To avoid error use `collection.index.get(pk)`.
     * @param pk item primary key.
     * @returns collection item.
     */
    get(pk:KeyType):Entity {
        let item = this.index.get(pk);
        if (item == null) {
            throw new Error(`Could not find '${this.name}' item with pk=${pk}`)
        }
        return item;
    }

    /**
     * Retrieves items from collection.
     */
    filter(params:IFilterParams):SliceArray<Entity> {
        let items:SliceArray<Entity> = [];

        let query = params.where;
        if (query == null) {
            for (let item of this.index) {
                items.push(item);
            }
        } else {
            // todo: intersection of indexes

            let bestIndex:UniqueIndex = this.index;

            let field:string, index:NonUniqueIndex;
            for ([field, index] of this.indexes) {
                // we exploit index if field equality is present in the query
                if ((field in query) && typeof query[field] !== 'object') {
                    let itemsIndex:UniqueIndex = index[query[field]];

                    if (itemsIndex == null) {
                        // short-circuit
                        items.total = 0;
                        return items;
                    }

                    if (itemsIndex.length < bestIndex.length) {
                        bestIndex = itemsIndex;
                    }
                }
            }

            let test = Criteria.tester(query);

            for (let item of bestIndex) {
                if (test(item)) {
                    items.push(item);
                }
            }
        }

        let total = items.length;

        if (params.orderBy != null) {
            items.sort(Ordering.comparator(params.orderBy));
        }

        if (params.offset != null) {
            if (params.orderBy == null)
                throw new Error("Can't use `offset` without `orderBy`");

            items = items.slice(params.offset);
        }

        if (params.limit != null) {
            if (params.orderBy == null)
                throw new Error("Can't use `limit` without `orderBy`");

            items = items.slice(0, params.limit);
        }

        items.total = total;
        return items;
    }

    /**
     * Creates mutable copy of collection item.
     * @param pk item primary key.
     * @param relations object mask for mutable backrefs.
     * @returns mutable copy of collection item.
     */
    getMutable(pk:KeyType, relations?:ObjectMask):Entity {
        let cacheItem = this.get(pk);
        let mutable = this.createInstance(cacheItem);

        if (relations == null)
            return mutable;

        // create mutable properties for backRefs
        for (let field in relations) {
            if (!relations.hasOwnProperty(field) || !relations[field])
                continue;

            let backRefConfig:IBackRefConfig = this.backRefs.get(field);

            if (backRefConfig == null)
                throw new Error(`No such backRef: ${field}`);

            let relatedCollection:Collection = this.db.getCollection(
                backRefConfig.collection);

            let backRefItemRelations;
            if (relations[field] instanceof Object) {
                backRefItemRelations = relations[field];
            }

            let backRef:UniqueIndex = cacheItem[field];
            let mutableBackRef:UniqueIndex = UniqueIndex(true);

            if (backRef != null) {
                for (let backRefItem of backRef) {
                    mutableBackRef.add(relatedCollection.getMutable(
                        backRefItem.pk, backRefItemRelations))
                }
            }

            Object.defineProperty(mutable, field, {
                value: mutableBackRef,
                writable: true,
                enumerable: true,
            });
        }

        mutable[MUTABLE_ITEM_RELATIONS] = relations;

        return mutable;
    }

    /**
     * Returns whether given item has changes from collection item with same
     * pk.
     * @param item mutable item.
     */
    hasChanges(item:Entity):boolean {
        return !isEqual(item, this.get(item.pk));
    }

    /**
     * Return diff of given item with collection item with same pk.
     * @param item mutable item.
     * @returns diff
     */
    getDiff(item:Entity):Object {
        let diff = {};
        let cacheItem = this.get(item.pk);

        for (let prop in item) {
            if (!item.hasOwnProperty(prop))
                continue;

            let value = item[prop];

            let backRefConfig:IBackRefConfig = this.backRefs.get(prop);
            if (backRefConfig != null) {
                let backRefCollection = this.db.getCollection(
                    backRefConfig.collection);

                let backRef:UniqueIndex = value;

                if (backRef == null)
                    continue;

                let diffs = [];
                let hasChanges = false;

                let oldBackRef:UniqueIndex = cacheItem[prop] || [];
                if (oldBackRef.length !== backRef.length)
                    hasChanges = true;

                for (let backRefItem of backRef) {
                    if (backRefItem.pk == null) {
                        hasChanges = true;
                        diffs.push(backRefItem);
                    } else {
                        let itemDiff = backRefCollection.getDiff(backRefItem);
                        hasChanges = hasChanges || !isObjectEmpty(itemDiff);
                        diffs.push(itemDiff);
                    }
                }

                if (hasChanges)
                    diff[prop] = diffs;
            } else {
                // plain property
                if (!isEqual(value, cacheItem[prop])) {
                    diff[prop] = value;
                }
            }
        }

        Object.defineProperty(diff, 'pk', { value: item.pk });

        return diff;
    }

    private processFetched<T extends Entity|Entity[]>(
        items:T, options:IFetchOptions
    ):Promise<T> {
        if (items instanceof Array) {
            Object.freeze(items);
        }

        return this.loadRelations(items, options.loadRelations);
    }

    /**
     * Fetch one item from Data Source by primary key and put it to the
     * collection.
     */
    fetchOne(pk:KeyType,
             options?:IFetchOptions & IDataSourceOptions):Promise<Entity> {
        let fetchOptions:IFetchOptions = options || {};
        let promise:Promise<any>;
        let cacheItem;

        if (!fetchOptions.forceLoad && (cacheItem = this.index.get(pk)) != null) {
            promise = common.Promise.resolve(cacheItem);
        } else {
            let pending = this.pendingItemRequests.get(pk);

            if (pending != null) {
                promise = pending.then(() => this.get(pk));
            } else {
                promise = this.source.findOne(pk, options)
                    .then((item) => this.insert(item));

                this.pendingItemRequests.set(pk, promise);
                always(promise, () => {
                    this.pendingItemRequests.delete(pk);
                })
            }
        }

        return promise.then((item) => this.processFetched(item, fetchOptions));
    }

    /**
     * Fetch items from Data Source by given params and put them to the
     * collection.
     */
    fetch(params:IFilterParams = {},
          options?:IFetchOptions & IDataSourceOptions
    ):Promise<SliceArray<Entity>> {
        let fetchOptions:IFetchOptions = options || {};

        if (params.where == null)
            params.where = {};

        let promise:Promise<any[]>;

        // key in `this.queries` to cache results
        let queryKey:string;

        // only cache requests without limit/offset
        if (params.limit == null && params.offset == null) {
            let cacheParams = Object.assign({}, params);
            delete cacheParams.orderBy;
            queryKey = stringify(cacheParams);
        }

        let cached:ICachedQuery;

        if (!fetchOptions.forceLoad && queryKey != null &&
            (cached = this.queries.get(queryKey)) != null) {
            // resolve to cached result
            let items = <SliceArray<Entity>>cached.items.slice();

            if (params.orderBy != null) {
                items.sort(Ordering.comparator(params.orderBy));
            }

            items.total = items.length;  // no limit/offset so these are equal
            promise = common.Promise.resolve(items);
        } else {
            // check if same request is currently pending
            let paramsKey = stringify(params);
            promise = this.pendingRequests.get(paramsKey);

            if (promise == null) {
                promise = this.source.find(params, options)
                    .then((items) => this.insertArray(items));

                // add to pending requests
                this.pendingRequests.set(paramsKey, promise);
                always(promise, () => {
                    this.pendingRequests.delete(paramsKey);
                });

                if (queryKey != null) {
                    // cache results
                    promise.then((items:SliceArray<Entity>) => {
                        let cachedQueryItems = UniqueIndex(true);
                        cachedQueryItems.add(...items);
                        this.queries.set(queryKey, {
                            where: params.where,
                            items: cachedQueryItems,
                        });
                    })
                }
            }
        }

        return promise.then((items) =>
            this.processFetched(items, fetchOptions)
        );
    }

    /**
     * Fetch items from Data Source by primary keys and put them to the
     * collection.
     */
    fetchAll(pks:KeyType[],
             options?:IFetchOptions & IDataSourceOptions
    ):Promise<Entity[]> {
        let fetchOptions:IFetchOptions = options || {};

        let promises:Promise<any>[] = [];
        let pksToLoad:KeyType[] = [];

        for (let pk of pks) {
            if (!fetchOptions.forceLoad && this.index.has(pk))
                continue;

            let pending = this.pendingItemRequests.get(pk);

            if (pending != null) {
                promises.push(pending);
            } else {
                pksToLoad.push(pk);
            }
        }

        if (pksToLoad.length !== 0) {
            // todo: leave only necessary options
            let promise = this.source.findAll(pksToLoad, options)
                .then((items) => this.insertArray(items));

            for (let pk of pksToLoad) {
                this.pendingItemRequests.set(pk, promise);
            }

            always(promise, () => {
                for (let pk of pksToLoad) {
                    this.pendingItemRequests.delete(pk);
                }
            });

            promises.push(promise);
        }

        return common.Promise.all(promises)
            .then(() => pks.map((pk) => this.index.get(pk)))
            .then((items) => this.processFetched(items, fetchOptions));
    }

    /**
     * Does a create on Data Source and puts response to the collection.
     */
    create(payload:Object,
           options?:ICommitOptions & IDataSourceOptions):Promise<Entity> {
        return this.source.create(payload, options)
            .then((item) => this.insert(item));
    }

    /**
     * Does an update on Data Source and puts response to the collection.
     */
    update(pk:KeyType, item:Object,
           options?:ICommitOptions & IDataSourceOptions):Promise<Entity> {
        if (pk == null)
            throw new Error(`Missing pk`);

        let commitOptions:ICommitOptions = options || {};

        let promise;
        let payload;
        if (commitOptions.diff) {
            payload = this.getDiff(<Entity>item);
        } else {
            payload = Object.assign({}, item);
            Object.defineProperty(payload, 'pk', { value: pk });
        }

        if (isObjectEmpty(payload)) {
            promise = Promise.resolve(this.index.get(pk));
        } else {
            promise = this.source.update(pk, payload, options)
                .then((item) => this.insert(item));
        }

        if (commitOptions.inplace) {
            promise = promise.then(() => {
                let newMutable = this.getMutable(pk,
                    item[MUTABLE_ITEM_RELATIONS]);

                Object.assign(item, newMutable);
                return item;
            });
        }

        return promise;
    }

    /**
     * Does a create or update depending on presence of pk in payload.
     */
    commit(item:Object,
           options?:ICommitOptions & IDataSourceOptions):Promise<Entity> {
        let pk = this.getPk(item);

        return pk == null ?
            this.create(item, options) :
            this.update(pk, item, options);
    }

    /**
     * Does a delete on Data Source removes corresponding item from collection.
     */
    delete(pk:KeyType, options?:IDataSourceOptions):Promise<any> {
        return this.source.delete(pk, options).then(() => {
            let cacheItem = this.index.get(pk);
            if (cacheItem != null) {
                this.remove(cacheItem);
            }
        });
    }

    private _getEagerLoadRelations():ObjectMask {
        let eagerLoadRelations;

        for (let [field, relationConfig] of this.relations) {
            if (relationConfig.eagerLoad) {
                if (eagerLoadRelations == null)
                    eagerLoadRelations = {};

                eagerLoadRelations[field] = true;
            }
        }

        return eagerLoadRelations;
    }

    /**
     * Loads relations for given item(s). Only fetches relations that are not
     * already in the collection.
     */
    loadRelations<T extends Entity|Entity[]>(
        items:T, relations?:ObjectMask
    ):Promise<T> {
        let eagerLoadRelations = this._getEagerLoadRelations();

        if (!relations && !eagerLoadRelations) {
            return common.Promise.resolve(items);
        }

        relations = Object.assign({}, eagerLoadRelations, relations);

        let itemsArray:Entity[] =
            <Entity[]><any>(items instanceof Array ? items : [items]);

        // map Collection name -> set of pks
        let toLoad = new Map<string, {[pk:string]: KeyType}>();

        // subset of `relations` that have nested masks as values
        let nestedRelations:{[key:string]: ObjectMask} = Object.create(null);

        // collect pks of relations to load
        for (let item of itemsArray) {
            if (item == null) {
                // this can happen if DataSource does not return all of
                // requested pks from findAll method
                continue;
            }

            for (let field in <ObjectMask>relations) {
                if (!relations.hasOwnProperty(field) || !relations[field])
                    continue;

                if (relations[field] instanceof Object) {
                    nestedRelations[field] = <ObjectMask>relations[field];
                }

                if (this.backRefs.has(field)) {
                    // todo: support loading backRefs
                    continue;
                }

                let relationConfig:IRelationConfig = this.relations.get(field);

                if (relationConfig == null)
                    throw new Error(`No such relation: ${field}`);

                let fieldValue = item[relationConfig.foreignKey];

                if (fieldValue == null) {
                    continue;
                }

                let relatedCollectionName = relationConfig.collection;
                let relatedCollection =
                    this.db.getCollection(relatedCollectionName);

                let pksToLoad = toLoad.get(relatedCollectionName);

                let pks:KeyType[] =
                    relationConfig.many ? fieldValue : [fieldValue];

                for (let pk of pks) {
                    if (relatedCollection.index.has(pk)) {
                        continue;
                    }

                    if (pksToLoad == null) {
                        pksToLoad = Object.create(null);
                        toLoad.set(relatedCollectionName, pksToLoad);
                    }

                    pksToLoad[pk.toString()] = pk;
                }
            }
        }

        // load collected relations
        let promises:Promise<Object[]>[] = [];

        for (let [collectionName, pksToLoad] of toLoad) {
            let collection = this.db.getCollection(collectionName);
            let pks:KeyType[] = objectValues(pksToLoad);

            promises.push(collection.fetchAll(pks));
        }

        return common.Promise.all(promises).then(() => {
            // load nested relations
            let promises:Promise<Object[]>[] = [];

            for (let field in nestedRelations) {
                let relationItems:Entity[] = [];
                let relatedCollectionName;
                let many:boolean;

                let relationConfig = this.relations.get(field);

                if (relationConfig != null) {
                    relatedCollectionName = relationConfig.collection;
                    many = !!relationConfig.many;
                } else {
                    relatedCollectionName =
                        this.backRefs.get(field).collection;
                    many = true;
                }

                if (many) {
                    for (let item of itemsArray) {
                        let itemRelationItems:Entity[] = item[field];
                        if (itemRelationItems == null)
                            continue;

                        Array.prototype.push.apply(
                            relationItems, itemRelationItems);
                    }
                } else {
                    for (let item of itemsArray) {
                        let relationItem:Entity = item[field];
                        if (relationItem == null)
                            continue;

                        relationItems.push(relationItem);
                    }
                }

                let relatedCollection =
                    this.db.getCollection(relatedCollectionName);

                promises.push(relatedCollection.loadRelations(
                    relationItems, nestedRelations[field]));
            }

            return common.Promise.all(promises);
        }).then(() => {
            return items
        });
    }
}