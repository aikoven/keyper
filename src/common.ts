
let NativePromise = Promise;

export let Promise = NativePromise;


export function always(promise:Promise<any>, callback:() => void) {
    promise.then(callback, callback);
}


export type KeyType = string|number|(string|number)[];

export interface Entity {
    pk: KeyType;
}