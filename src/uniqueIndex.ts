import {KeyType, Entity} from './common';
import {sortedIndex} from './utils';
import {Ordering} from './query';


export type UniqueIndex = UniqueIndexArrayExt;


export function UniqueIndex(mutable:boolean = false):UniqueIndex {
    let index:UniqueIndex = Object.create(Array.prototype);
    index = Array.apply(index) || index;

    // apply mixin
    let properties = Object.getOwnPropertyNames(UniqueIndexArrayExt.prototype);
    for (let prop of properties) {
        Object.defineProperty(index, prop, {
            enumerable: false,
            configurable: true,
            writable: true,
            value: UniqueIndexArrayExt.prototype[prop]
        });
    }

    Object.defineProperty(index, '_items', {
        enumerable: false,
        configurable: true,
        writable: true,
        value: Object.create(null)
    });

    if (!mutable)
        index.freeze();

    return index;
}


const pkComparator = Ordering.comparator('pk');

class UniqueIndexArrayExt extends Array<Entity> {
    static get [Symbol.species]() { return Array; }

    private _items: {[pk:string]: Entity};

    freeze():void {
        Object.freeze(this);
        Object.freeze(this._items);
    }

    get(pk:KeyType):Entity {
        if (pk == null)
            throw new Error('Missing pk');
        return this._items[pk.toString()];
    }

    has(pk:KeyType):boolean {
        return pk.toString() in this._items;
    }

    copy(freeze:boolean = false):UniqueIndexArrayExt {
        let result = UniqueIndex(true);

        for (let item of this) {
            result.push(item);
            result._items[item.pk.toString()] = item;
        }

        if (freeze)
            result.freeze();

        return result;
    }

    add(...items:Entity[]):UniqueIndexArrayExt {
        let result:UniqueIndex;
        let frozen = Object.isFrozen(this);

        if (frozen) {
            result = this.copy();
        } else {
            result = this;
        }

        let replace:boolean, idx:number, strPk:string;
        for (let item of items) {
            strPk = item.pk.toString();
            replace = (strPk in result._items);
            idx = sortedIndex(result, item, pkComparator);
            result.splice(idx, replace ? 1 : 0, item);
            result._items[strPk] = item;
        }

        if (frozen)
            result.freeze();

        return result;
    }

    remove(...pks:KeyType[]):UniqueIndexArrayExt {
        let result:UniqueIndex;
        let frozen = Object.isFrozen(this);

        if (Object.isFrozen(this)) {
            result = this.copy();
        } else {
            result = this;
        }

        let idx:number, strPk:string;
        for (let pk of pks) {
            strPk = pk.toString();
            if (strPk in result._items) {
                idx = sortedIndex(result, {pk: pk}, pkComparator);
                result.splice(idx, 1);
                delete result._items[strPk];
            }
        }

        if (frozen)
            Object.freeze(result);

        return result;
    }
}
