
declare module "json-stable-stringify" {
    function stringify(obj:any, opts?:{
        cmp?:Function,
        space?:string|number,
        cycles?:boolean,
        replacer?:Function,
    }):string;

    export default stringify;
}