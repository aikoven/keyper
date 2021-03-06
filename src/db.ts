import Signal from 'signals';
import {
    Collection, COLLECTION_NAME, ICollectionConfig,
} from './collection';
import {IDataSourceConfig} from './dataSource';


export interface CollectionConstructor<T extends Collection> {
    new (db:DB<T>, name:string, config:ICollectionConfig):T;
}


let identity = (item) => item;


/**
 * `DB` is a container for [[Collection]]s. Usually you will have single
 * instance of `DB` in your application.
 */
export class DB<T extends Collection> {
    collections = new Map<string, T>();
    collectionCreated:Signal = new Signal();

    private _collectionConstructor:CollectionConstructor<T>;

    collectionDefaults:ICollectionConfig = {
        primaryKey: 'id',

        beforeSend: identity,
        beforeInsert: identity,
        relations: {},

        itemPrototype: Object.prototype,
    };

    constructor(collectionClass:CollectionConstructor<T>) {
        this._collectionConstructor = collectionClass;
    }

    getCollection(name:string):T {
        let collection = this.collections.get(name);
        if (collection == null) {
            throw new Error(`Collection '${name}' does not exist`)
        }
        return collection;
    }

    getCollectionOf(item):T {
        return this.getCollection(item[COLLECTION_NAME]);
    }

    createCollection(name:string,
                     config?:ICollectionConfig & IDataSourceConfig):T {
        if (this.collections.has(name)) {
            throw new Error(`Collection '${name}' already defined`);
        }

        if (this[name] != null) {
            throw new Error(`Can't add '${name}' shortcut to DB instance: ` +
                `property exists`)
        }

        config = Object.assign({}, this.collectionDefaults, config);
        let collection = new this._collectionConstructor(this, name, config);
        this.collections.set(name, collection);

        this[name] = collection;

        this.collectionCreated.dispatch(collection);

        return collection;
    }
}