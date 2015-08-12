
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
 * Used to describe a subset of object tree.
 */
export interface ObjectMask {
    [key:string]: boolean|ObjectMask;
}

/**
 * Function that defines the sort order. See {@link external:Array#sort}.
 */
export type Comparator = <T>(a:T, b:T) => number;