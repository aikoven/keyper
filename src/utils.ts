import {Comparator} from './common';

/**
 * Returns the lowest index at which item should be inserted into array in
 * order to maintain its sort order.
 *
 * @param array
 * @param item
 * @param cmp Comparator function
 * @returns
 */
export function sortedIndex<T>(array:T[], item:T, cmp:Comparator):number {
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


/**
 * Recursively freezes object and all its own enumerable properties using
 * [Object.freeze](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/freeze).
 *
 * @param object Object to freeze.
 */
export function deepFreeze(object:any):void {
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
 * Clone any-dimensional array.
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


/**
 * Returns whether object has at least one own enumerable property.
 *
 * @param object
 * @returns
 */
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


/**
 * Attaches callback for both resolution and rejection of a Promise.
 *
 * @param promise Promise to attach callback to.
 * @param callback The callback to execute when the Promise is
 * resolved or rejected.
 */
export function always(promise:Promise<any>, callback:() => void):void {
    promise.then(callback, callback);
}


/**
 * For given dot-separated field chain creates function that accepts
 * object and returns value nested field.
 *
 * Example:
 *
 *     let obj = {a: {b: 42}};
 *     let getter = fieldGetter('a.b');
 *     getter(obj);  // 42
 *
 * @param field field or dot-separated field chain
 * @returns
 */
export function fieldGetter(field:string):(obj:Object) => any {
    let chain:string[] = field.split('.');
    if (chain.length === 1) {
        return obj => obj == null ? undefined : obj[field];
    }
    return obj => {
        for (let i = 0, len = chain.length; i < len; i++) {
            if (obj == null)
                return undefined;

            obj = obj[chain[i]];
        }
        return obj;
    }
}
