import {Comparator} from './common';
import {fieldGetter} from './utils';

export type Primitive = boolean|number|string;

export interface ICriteria {}

export module Criteria {
    let operators = {
        $eq: (what, value:Primitive) => what === value,
        $ne: (what, value:Primitive) => what !== value,
        $lt: (what, value:Primitive) => what < value,
        $lte: (what, value:Primitive) => what <= value,
        $gt: (what, value:Primitive) => what > value,
        $gte: (what, value:Primitive) => what >= value,

        $like: (what:string, value:string) => {
            if (value.charAt(0) === '%') {
                if (value.charAt(value.length-1) === '%') {
                    return what.indexOf(value.substr(1, value.length-2))
                        !== -1;
                } else {
                    return what.endsWith(value.substr(1));
                }
            } else {
                if (value.charAt(value.length-1) === '%') {
                    return what.startsWith(value.substr(0, value.length-1));
                } else {
                    throw new Error(`Invalid $like operator parameter: `+
                        `${value}`)
                }
            }
        },

        $in: (what, values:Primitive[]) => values.indexOf(what) !== -1,
        $nin: (what, values:Primitive[]) => values.indexOf(what) === -1,

        // operators on arrays
        $any: (what:any[], value:ICriteria) => {
            for (let i = 0, len = what.length; i < len; i++) {
                if (test(what[i], value)) {
                    return true;
                }
            }
            return false;
        },

        $all: (what:any[], value:ICriteria) => {
            for (let i = 0, len = what.length; i < len; i++) {
                if (!test(what[i], value)) {
                    return false;
                }
            }
            return true;
        },

        $length: (what:any[], value:ICriteria|number) => {
            if (!(value instanceof Object)) {
                value = {$eq: value};
            }
            return test(what.length, value);
        },

        // logical operators
        $and: (what, values:ICriteria[]) => {
            for (let i = 0, len = values.length; i < len; i++) {
                if (!test(what, values[i])) {
                    return false;
                }
            }
            return true;
        },

        $or: (what, values:ICriteria[]) => {
            for (let i = 0; i < values.length; i++) {
                if (test(what, values[i])) {
                    return true;
                }
            }
            return false;
        },

        $nor: (what, values:ICriteria[]) => {
            for (let i = 0; i < values.length; i++) {
                if (test(what, values[i])) {
                    return false;
                }
            }
            return true;
        },

        $not: (what, value:ICriteria) => !test(what, value)
    };

    export function test(what, criteria:ICriteria) {
        let value;
        for (let key in criteria) {
            if (!criteria.hasOwnProperty(key))
                continue;

            value = criteria[key];
            if (typeof value === 'undefined') {
                continue;
            }
            if (key in operators) {
                if (!operators[key](what, value)) {
                    return false;
                }
            } else {
                if (!(value instanceof Object)) {
                    value = {
                        $eq: value
                    };
                }
                if (!test(fieldGetter(key)(what), value)) {
                    return false;
                }
            }
        }
        return true;
    }

    export function tester(criteria:ICriteria) {
        return (what) => test(what, criteria)
    }
}


export module Ordering {
    let fieldComparatorRegex = /^(.*?)([+-]?)$/;

    function cmp(a, b) {
        if (a < b) {
            return -1;
        }
        if (a === b) {
            return 0;
        }
        return 1;
    }

    /**
     * Returns comparator for given field in form 'field[+]' or 'field-'
     */
    function fieldComparator(expr:string):Comparator {
        let match = fieldComparatorRegex.exec(expr);
        if (match == null || match.length !== 3) {
            throw new Error(`Invalid field comparator: ${expr}`);
        }
        let [field, suffix] = match.slice(1);
        let getField = fieldGetter(field);

        // todo: make this configurable
        let calcField = (o) => {
            let value = getField(o);
            if (typeof value === 'string') {
                value = value.toLowerCase();
            }
            return value;
        };

        if (suffix === '-') {
            return (a, b) => cmp(calcField(b), calcField(a));
        } else {
            return (a, b) => cmp(calcField(a), calcField(b));
        }
    }

    /**
     * For given comparators array produces compound comparator
     * @param comparators
     * @returns
     */
    export function compoundComparator(comparators:Comparator[]):Comparator {
        return (a, b) => {
            for (let comparator of comparators) {
                let res = comparator(a, b);
                if (res !== 0) {
                    return res;
                }
            }
            return 0;
        };
    }

    export function comparator(ordering:string|string[]):Comparator {
        if (typeof ordering === 'string') {
            return fieldComparator(ordering);
        } else {
            return compoundComparator(ordering.map(fieldComparator));
        }
    }
}