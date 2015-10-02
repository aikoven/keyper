
let NativePromise = Promise;

export let Promise = NativePromise;

/**
 * The type for unique keys that can be strings, numbers or tuples of these.
 */
export type KeyType = string|number|(string|number)[];

export interface Entity {
    /**
     * Primary key.
     */
    pk: KeyType;
}

/**
 * Represents array that is a slice of a bigger array.
 */
export interface SliceArray<T> extends Array<T> {
    /** Number of items in bigger array. */
    total?: number;
}

/**
 * Used to describe a subset of object tree.
 */
export interface ObjectMask {
    [key:string]: boolean|ObjectMask;
}

/**
 * Function that defines the sort order. See
 * [Array.sort](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort).
 */
export type Comparator = <T>(a:T, b:T) => number;