import {default as Signal} from 'signals';
import {default as stringify} from 'json-stable-stringify';
import {UniqueIndex} from './uniqueIndex';
import {ICriteria, Criteria, Ordering} from './query';
import {
    sortedIndex, deepFreeze, deepAssign, isObjectEmpty,
    objectValues, isEqual, always
} from './utils';

import * as common from './common';
import {KeyType, Entity, ObjectMask} from './common';


export interface SliceArray<T> extends Array<T> {
    total?: number;
}


export interface IDataSource {
    findOne(pk:KeyType, options?:IDataSourceOptions):Promise<any>;
    find(params:IFetchOptions, options?:IDataSourceOptions)
        :Promise<SliceArray<any>>;
    findAll(pks:KeyType[], options?:IDataSourceOptions):Promise<any[]>;

    update(pk:KeyType, item:Object, options?:IDataSourceOptions):Promise<any>;
    create(item:Object, options?:IDataSourceOptions):Promise<any>;
    delete(pk:KeyType, options?:IDataSourceOptions):Promise<any>;
}


export interface IRelationConfig {
    collection: string,
    many?:boolean,
    foreignKey?: string,
    backRef?: string,
}


export interface IBackRefConfig {
    collection: string,
    foreignKey: string,
}


export interface ICollectionConfig {
    primaryKey?: string|string[];
    sourceClass?: {
        new (collection:Collection):IDataSource;
    };

    beforeSend?: (Object) => Object;
    beforeInsert?: (Object) => Object;

    parent?:string;
    relations?: {[key:string]: IRelationConfig|string};

    itemPrototype?: any;
}

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


    loadRelations?: ObjectMask;
}


export interface ICommitOptions extends IDataSourceOptions {
    diff?: boolean;
    inplace?: boolean;
}


type NonUniqueIndex = {[fk:string]: UniqueIndex};

const EMPTY_INDEX = UniqueIndex();


interface ICachedQuery {
    where: ICriteria;
    items: UniqueIndex;
}


export let COLLECTION_NAME = Symbol('collection name');
let MUTABLE_ITEM_RELATIONS = Symbol('mutable item relations');


export interface IDataBase {
    getCollection(name:string):Collection;
}


export class Collection {
    // signals
    inserted = new Signal();
    removed = new Signal();

    name:string;
    config:ICollectionConfig;

    db:IDataBase;

    index:UniqueIndex = UniqueIndex();

    /**
     * Maps field name to index by this field.
     * Each index maps field value to collection of objects keyed by pk.
     */
    private indexes = new Map<string, NonUniqueIndex>();

    /**
     * Maps serialized `fetch()` params to results of completed `fetch()`
     * calls.
     */
    private queries = new Map<string, ICachedQuery>();

    /**
     * Maps serialized filter params to pending fetch() calls.
     */
    private pendingRequests = new Map<string, Promise<SliceArray<Entity>>>();

    /**
     * Maps keys to promises that upon resolution will put corresponding item
     * to the store
     */
    private pendingItemRequests = new Map<KeyType, Promise<any>>();

    source:IDataSource;
    private itemPrototype;

    relations = new Map<string, IRelationConfig>();
    backRefs = new Map<string, IBackRefConfig>();

    /**
     * Map foreign key field to relation field.
     */
    foreignKeys = new Map<string, string>();

    childCollections:string[] = [];

    meta:any = {};

    constructor(db:IDataBase, name:string, config:ICollectionConfig) {
        this.db = db;
        this.name = name;
        this.config = config;

        this.itemPrototype = Object.create(config.itemPrototype);
        this.itemPrototype[COLLECTION_NAME] = name;

        // relations
        for (let field in config.relations) {
            if (config.relations.hasOwnProperty(field)) {
                this.addRelation(field, config.relations[field]);
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

        this.source = new config.sourceClass(this);
    }

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

    private addRelation(field:string,
                        relationConfig:IRelationConfig|string):void {
        let config:IRelationConfig = typeof relationConfig === 'string' ?
        {collection: relationConfig} : relationConfig;

        let relatedCollection = config.collection === this.name ?
            this : this.db.getCollection(config.collection);

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
            let index:NonUniqueIndex = this.indexes.get(config.foreignKey);

            Object.defineProperty(relatedCollection.itemPrototype, backRef, {
                get: function backRefGetter():UniqueIndex {
                    let key = this.pk;
                    if (key == null)
                        return EMPTY_INDEX;

                    let backRef = index[key];
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
     * Create mutable instance with item prototype
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

    get(pk:KeyType):Entity {
        let item = this.index.get(pk);
        if (item == null) {
            throw new Error(`Could not find '${this.name}' item with pk=${pk}`)
        }
        return item;
    }

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

    hasChanges(item:Entity):boolean {
        return !isEqual(item, this.get(item.pk));
    }

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

    private processFetched(items:Object|Object[], options:IFetchOptions) {
        if (items instanceof Array) {
            Object.freeze(items);
        }

        let promise = common.Promise.resolve(items);

        if (options.loadRelations) {
            promise = promise.then(
                (items) => this.loadRelations(items, options.loadRelations)
            );
        }

        return promise;
    }

    /**
     * Fetch one item from Data Source by primary key and put it to index.
     */
    fetchOne(pk:KeyType, options:IFetchOptions = {}):Promise<Entity> {
        let promise:Promise<any>;
        let cacheItem;

        if (!options.forceLoad && (cacheItem = this.index.get(pk)) != null) {
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

        return promise.then((item) => this.processFetched(item, options));
    }

    /**
     * Fetch items from Data Source by given params and put them to index.
     */
    fetch(params:IFilterParams = {},
          options:IFetchOptions = {}):Promise<SliceArray<Entity>> {
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

        if (!options.forceLoad && queryKey != null &&
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

        return promise.then((items) => this.processFetched(items, options));
    }

    /**
     * Fetch items from Data Source by primary keys and put them to index.
     */
    fetchAll(pks:KeyType[], options:IFetchOptions = {}):Promise<Entity[]> {
        let promises:Promise<any>[] = [];
        let pksToLoad:KeyType[] = [];

        for (let pk of pks) {
            if (!options.forceLoad && this.index.has(pk))
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
            .then((items) => this.processFetched(items, options));
    }

    create(payload:Object, options?:ICommitOptions):Promise<Entity> {
        return this.source.create(payload, options)
            .then((item) => this.insert(item));
    }

    update(pk:KeyType, item:Object,
           options:ICommitOptions = {}):Promise<Entity> {
        if (pk == null)
            throw new Error(`Missing pk`);

        let promise;
        let payload;
        if (options.diff) {
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

        if (options.inplace) {
            promise = promise.then(() => {
                let newMutable = this.getMutable(pk,
                    item[MUTABLE_ITEM_RELATIONS]);

                Object.assign(item, newMutable);
                return item;
            });
        }

        return promise;
    }

    commit(item:Object, options?:ICommitOptions):Promise<Entity> {
        let pk = this.getPk(item);

        return pk == null ?
            this.create(item, options) :
            this.update(pk, item, options);
    }

    delete(pk:KeyType, options?:IDataSourceOptions):Promise<any> {
        return this.source.delete(pk, options).then(() => {
            let cacheItem = this.index.get(pk);
            if (cacheItem != null) {
                this.remove(cacheItem);
            }
        });
    }

    loadRelations(items:Object|Object[], relations?:ObjectMask) {
        if (!relations) {
            return common.Promise.resolve(items);
        }

        let itemsArray = items instanceof Array ? items : [items];

        // map Collection name -> set of pks
        let toLoad = new Map<string, {[pk:string]: KeyType}>();
        let nestedRelations:{[key:string]: ObjectMask} = Object.create(null);

        for (let item of itemsArray) {
            let relationConfig:IRelationConfig,
                relatedCollectionName:string,
                relatedCollection:Collection,
                pks:KeyType[],
                pksToLoad:{[pk:string]: KeyType};

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

                relationConfig = this.relations.get(field);

                if (relationConfig == null)
                    throw new Error(`No such relation: ${field}`);

                let fieldValue = item[relationConfig.foreignKey];

                if (fieldValue == null) {
                    continue;
                }

                relatedCollectionName = relationConfig.collection;
                relatedCollection =
                    this.db.getCollection(relatedCollectionName);

                pksToLoad = toLoad.get(relatedCollectionName);

                pks = relationConfig.many ? fieldValue : [fieldValue];

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

        let promises:Promise<Object[]>[] = [];

        for (let [collectionName, pksToLoad] of toLoad) {
            let collection = this.db.getCollection(collectionName);
            let pks:KeyType[] = objectValues(pksToLoad);

            promises.push(collection.fetchAll(pks));
        }

        return common.Promise.all(promises)
            .then(() => {
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
            })
            .then(() => items);
    }
}