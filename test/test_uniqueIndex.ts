import {UniqueIndex} from '../src/uniqueIndex';
import chai from 'chai';

let expect = chai.expect;
chai.should();

describe('uniqueIndex', () => {
    it('allows array syntax', () => {
        let index = UniqueIndex().add({pk: 1}, {pk: 2});
        expect(index[1].pk).to.equal(2);
    });

    it('allows querying items by pk', () => {
        let index = UniqueIndex().add({pk: 1, ['a']: 42}, {pk: 2, ['a']:43});
        expect(index.get(1)['a']).to.equal(42);
    });

    it('produces regular array from map()', () => {
        let index = UniqueIndex().add(({pk: 1}, {pk: 2}));
        let mapped = index.map(item => item.pk);

        expect(Object.getPrototypeOf(mapped)).to.equal(Array.prototype);
    });
});
