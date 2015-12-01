# Keyper [![Build Status](https://travis-ci.org/aikoven/keyper.svg)](https://travis-ci.org/aikoven/keyper)
Persistence layer/in-memory data store. Inspired by [js-data](https://github.com/js-data/js-data). Written in TypeScript.

## Key features
* Immutable objects in the store
* Unique and non-unique indexes
* Strong emphasis on relations. Supports m2m relations and backrefs via getter properties. Supports automatic loading of requested relations once objects were fetched
* Built-in MongoDB-flavored query syntax
* Live collection views, paginated and "Load More" views

## Installation
```
npm install --save keyper
```

## Quick start
Set up *Data Source*:

```ts
// dataSource.ts
import {AbstractRestApiDataSource} from 'keyper/src/dataSource/restApi';
import {stringify} from 'querystring';

export class RestApiDataSource extends AbstractRestApiDataSource {
  protected makeRequest(methodName:string, url:string,
                        params:any, payload:any) {
    let request;
    switch (methodName) {
      case 'create':
      case 'update':
        request = fetch(url, {
          method: methodName === 'create' ? 'post' : 'put', 
          body: JSON.stringify(payload)
        });
        break;
      case 'delete'
        request = fetch(url, {method: 'delete'});
        break;
      case 'find':
      case 'findOne':
        request = fetch(`${url}?${serialize(params)}`);
        break;
    }
    return request.then(response => response.json());
  }
  
  protected createFindAllParams(pks:KeyType[]):IFilterParams {
    // request params needed to fetch items by list of pks
    return {where: {
      [this.collection.config.primaryKey]: {$in: pks}
    }};
  }
}
```

Set up *Collections*:

```ts
import {DB, Collection} from 'keyper';
import {RestApiDataSource} from './dataSource';

const db = new DB(Collection);
db.collectionDefaults.sourceClass = RestApiDataSource;

export const Users = db.createCollection('Users', {
  endpoint: 'users'
});

export const Posts = db.createCollection('Posts', {
  endpoint: 'posts',
  relations: {
    // this will create relation using `author_id` as
    // a foreign key:
    author: 'Users'
    
    // above form is a shortcut for the following:
    //  author: {
    //    collection: 'Users',
    //    foreignKey: 'author_id'
    //  }
  }
});
```

Query Collections:

```ts
// this will fetch all Posts and then all Users that are
// related to them as authors
Posts.fetch({}, {
  loadRelations: {
    author: true
  }
}).then((posts) => {
  // get Post author via relation property
  let author = posts[0].author;
});
```
