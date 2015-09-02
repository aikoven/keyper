import {Criteria, Ordering} from '../es6/query';
import chai from 'chai';

let expect = chai.expect;
chai.should();


describe('query', () => {
    describe('Criteria', () => {
        it("tests simple operator criteria", () => {
            expect(Criteria.test(42, {$eq: 42})).to.equal(true);
            expect(Criteria.test(42, {$eq: 43})).to.equal(false);
            expect(Criteria.test(42, {$lt: 43, $gt: 41})).to.equal(true);

            expect(Criteria.test(42, {$in: [41, 42, 43]})).to.equal(true);
            expect(Criteria.test(1, {$in: [41, 42, 43]})).to.equal(false);

            expect(Criteria.test(42, {$nin: [1, 2, 3]})).to.equal(true);
            expect(Criteria.test(1, {$nin: [1, 2, 3]})).to.equal(false);

            expect(Criteria.test(42, {
                $and: [
                    {$eq: 42},
                    {$eq: 43}
                ]
            })).to.equal(false);
            expect(Criteria.test(42, {
                $and: [
                    {$in: [41, 42, 43]},
                    {$in: [32, 42, 52]}
                ]
            })).to.equal(true);
            expect(Criteria.test(42, {
                $and: [
                    {$in: [1, 2, 3]},
                    {$in: [41, 42, 43]}
                ]
            })).to.equal(false);
            expect(Criteria.test(42, {
                $or: [
                    {$in: [1, 2, 3]},
                    {$in: [41, 42, 43]}
                ]
            })).to.equal(true);

            expect(Criteria.test(42, {$not: {$eq: 43}})).to.equal(true);

            expect(Criteria.test('string', {$like: '%str%'})).to.equal(true);
            expect(Criteria.test('string', {$like: '%rrr%'})).to.equal(false);
            expect(Criteria.test('string', {$like: '%string'})).to.equal(true);
            expect(Criteria.test('string', {$like: '%rrr'})).to.equal(false);
            expect(Criteria.test('string', {$like: 'str%'})).to.equal(true);
            expect(Criteria.test('string', {$like: 'rrr%'})).to.equal(false);

            expect(Criteria.test(
                [{a: 42}, {a: 43}],
                {$any: {a: 43}}
                )).to.equal(true);
            expect(Criteria.test(
                    [{a: 42}, {a: 43}],
                    {$all: {a: 43}}
                )).to.equal(false);
            expect(Criteria.test(
                    [{a: 42}, {a: 43}],
                    {$all: {a: {$gt: 40}}}
                )).to.equal(true);
        });

        it("skips undefined values", () => {
            expect(Criteria.test(42, {$eq: undefined})).to.equal(true);
            expect(Criteria.test(42, {$eq: null})).to.equal(false);
        });
        it("test criteria on properties", () => {
            let obj = {a: 42};
            expect(Criteria.test(obj, {a: 42})).to.equal(true);
            expect(Criteria.test(obj, {a: 43})).to.equal(false);
            expect(Criteria.test(obj, {a: {$eq: 42}})).to.equal(true);
            expect(Criteria.test(obj, {
                a: {
                    $and: [
                        {$eq: 42},
                        {$eq: 43}
                    ]
                }
            })).to.equal(false);
        });
        it("test criteria on nested properties", () => {
            let obj = {a: {b: 42}};
            expect(Criteria.test(obj, {'a.b': 42})).to.equal(true);
            expect(Criteria.test(obj, {'a.b': 43})).to.equal(false);
            expect(Criteria.test(obj, {'a.b': {$eq: 42}})).to.equal(true);
            expect(Criteria.test(obj, {
                'a.b': {
                    $and: [
                        {$eq: 42},
                        {$eq: 43}
                    ]
                }
            })).to.equal(false);
            expect(Criteria.test(obj, {'a.c': {$ne: 42}})).to.equal(true);
        });
    });

    describe('Ordering', () => {
        function sort(collection, ordering) {
            let copy = collection.slice();
            copy.sort(Ordering.comparator(ordering));
            return copy;
        }

        it("sorts by single field", () => {
            let collection = [
                {a: 2},
                {a: 3},
                {a: 1}
            ];
            expect(sort(collection, 'a')).to.deep.equal([
                {a: 1}, {a: 2}, {a: 3}
            ]);
            expect(sort(collection, 'a+')).to.deep.equal([
                {a: 1},
                {a: 2},
                {a: 3}
            ]);
            expect(sort(collection, 'a-')).to.deep.equal([
                {a: 3},
                {a: 2},
                {a: 1}
            ]);
        });
        it("sorts by multiple fields", () => {
            let collection = [
                {a: 1, b: 2},
                {a: 2, b: 1},
                {a: 1, b: 1}
            ];
            expect(sort(collection, ['a', 'b'])).to.deep.equal([
                {a: 1, b: 1},
                {a: 1, b: 2},
                {a: 2, b: 1}
            ]);
            expect(sort(collection, ['a', 'b-'])).to.deep.equal([
                {a: 1, b: 2},
                {a: 1, b: 1},
                {a: 2, b: 1}
            ]);
        });
        it("sorts by nested field", () => {
            let collection = [
                {a: {b: 2}},
                {a: {b: 3}},
                {a: {b: 1}}
            ];
            expect(sort(collection, 'a.b')).to.deep.equal([
                {a: {b: 1}},
                {a: {b: 2}},
                {a: {b: 3}}
            ]);
            expect(sort(collection, 'a.b+')).to.deep.equal([
                {a: {b: 1}},
                {a: {b: 2}},
                {a: {b: 3}}
            ]);
            expect(sort(collection, 'a.b-')).to.deep.equal([
                {a: {b: 3}},
                {a: {b: 2}},
                {a: {b: 1}}
            ]);
        });
    });
});
