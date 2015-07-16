
let NativePromise = Promise;

export let Promise = NativePromise;


export type KeyType = string|number|(string|number)[];

export interface Entity {
    pk: KeyType;
}

export interface ObjectMask {
    [key:string]: boolean|ObjectMask;
}


export type Comparator = <T>(a:T, b:T) => number;