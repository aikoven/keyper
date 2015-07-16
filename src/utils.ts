import {Comparator} from './common';

export function sortedIndex(array:any[], item, cmp:Comparator) {
    let low = 0, high = array.length, mid;

    while (low < high) {
        mid = (low + high) >>> 1;

        if (cmp(array[mid], item) < 0) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }

    return high;
}


let hasOwnProperty = Object.prototype.hasOwnProperty;


export function deepFreeze(object:any) {
    let prop, propKey;
    Object.freeze(object);
    for (propKey in object) {
        prop = object[propKey];
        if (hasOwnProperty.call(object, propKey) &&
            (prop instanceof Object) && !Object.isFrozen(prop)) {
            deepFreeze(prop);
        }
    }
}


/**
 * Clone any-dimensional array
 */
export function cloneArray(array:Array<any>):Array<any> {
    return array.map((item) => {
        if (item instanceof Array) {
            return cloneArray(item);
        } else {
            return deepAssign(null, item);
        }
    });
}


export function deepAssign(target:any, source:any):any {
    if (source instanceof Array) {
        throw new Error(`deepAssign'ing Arrays is not supported`);
    }

    if (target == null) {
        if (source instanceof Object) {
            target = Object.create(Object.getPrototypeOf(source));
        } else {
            // primitive
            return source;
        }
    }

    let value;
    for (let prop in source) {
        if (hasOwnProperty.call(source, prop)) {
            value = source[prop];

            if (value instanceof Array) {
                value = cloneArray(value);
            } else if (value instanceof Object &&
                Object.getPrototypeOf(value) === Object.prototype) {
                // skip custom types because they can't be cloned safely
                value = deepAssign(target[prop], value);
            }

            Object.defineProperty(target, prop, {
                configurable: true,
                enumerable: true,
                value: value,
                writable: true,
            });
        }
    }

    return target;
}


export function isObjectEmpty(object:{}):boolean {
    for (let prop in object) {
        if (hasOwnProperty.call(object, prop))
            return false;
    }
    return true;
}


export function objectValues<T>(object:{[key:string]: T}):T[] {
    let values = [];
    for (let prop in object) {
        if (hasOwnProperty.call(object, prop))
            values.push(object[prop]);
    }

    return values;
}


export function isEqual(x, y) {
    if (x === y)
        return true;

    if (!( x instanceof Object ) || !( y instanceof Object ))
        return false;

    if (x.constructor !== y.constructor)
        return false;

    let p;

    for (p in x) {
        if (!x.hasOwnProperty(p))
            continue;

        if (!y.hasOwnProperty(p))
            return false;

        if (x[p] === y[p])
            continue;

        if (typeof( x[p] ) !== "object")
            return false;

        if (!isEqual(x[p], y[p]))
            return false;
    }

    for (p in y) {
        if (y.hasOwnProperty(p) && !x.hasOwnProperty(p))
            return false;
    }

    return true;
}


export function always(promise:Promise<any>, callback:() => void) {
    promise.then(callback, callback);
}


export function fieldGetter(field:string) {
    let chain:string[] = field.split('.');
    if (chain.length === 1) {
        return obj => obj[field];
    }
    return obj => {
        for (let i = 0, len = chain.length; i < len; i++) {
            obj = obj[chain[i]];
            if (obj == null) {
                break;
            }
        }
        return obj;
    }
}
