import {KeyType, Entity} from './common';
import {sortedIndex} from './utils';
import {Ordering} from './query';


export interface UniqueIndex extends Array<Entity>, UniqueIndexArrayMixin {
}


export function UniqueIndex(mutable:boolean = false):UniqueIndex {
    let index:UniqueIndex = Object.create(Array.prototype);
    index = Array.apply(index) || index;

    // apply mixin
    let prop:string;
    for (prop of Object.getOwnPropertyNames(UniqueIndexArrayMixin.prototype)) {
        Object.defineProperty(index, prop, {
            enumerable: false,
            configurable: true,
            writable: true,
            value: UniqueIndexArrayMixin.prototype[prop]
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


let pkComparator = Ordering.comparator('pk');


class UniqueIndexArrayMixin {
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

    copy(freeze:boolean = false):UniqueIndex {
        let result = UniqueIndex(true);

        for (let item of <UniqueIndex>this) {
            result.push(item);
            result._items[item.pk.toString()] = item;
        }

        if (freeze)
            result.freeze();

        return result;
    }

    add(...items:Entity[]):UniqueIndex {
        let result:UniqueIndex;
        let frozen = Object.isFrozen(this);

        if (frozen) {
            result = this.copy();
        } else {
            result = <UniqueIndex>this;
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

    remove(...pks:KeyType[]):UniqueIndex {
        let result:UniqueIndex;
        let frozen = Object.isFrozen(this);

        if (Object.isFrozen(this)) {
            result = this.copy();
        } else {
            result = <UniqueIndex>this;
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
