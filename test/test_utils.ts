import * as utils from '../src/utils';
import chai from 'chai';

let expect = chai.expect;
chai.should();

describe('utils', () => {
    describe('#fieldGetter()', () => {
        it('works with simple field', () => {
            let getField = utils.fieldGetter('field');

            getField({field: 42}).should.equal(42);
            getField({field: 'abc'}).should.equal('abc');
            expect(getField({other: 'abc'})).to.equal(undefined);
        });

        it('works with nested fields', () => {
            let getField = utils.fieldGetter('nested.field');

            expect(getField({field: 42})).to.equal(undefined);
            getField({nested: {field: 42}}).should.equal(42);
            expect(getField({other: 'abc'})).to.equal(undefined);
        });

        it('stops chained property access on null objects', () => {
            let getField = utils.fieldGetter('nested.field');

            expect(getField({nested: null})).to.equal(undefined);
        })
    })

});
