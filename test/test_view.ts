import chai from 'chai';

import {Collection} from '../src/collection';
import {DB} from '../src/db';

import {CollectionView} from '../src/view';

import {TestDataSource, pause} from './helpers';

let expect = chai.expect;


describe('view', () => {
    let db:DB<Collection>;
    let Users:Collection, Posts:Collection;
    let usersSource:TestDataSource, postsSource:TestDataSource;

    beforeEach('setup test db', () => {
        db = new DB(Collection);
        db.collectionDefaults.sourceClass = TestDataSource;

        Users = db.createCollection('Users');
        usersSource = <TestDataSource>Users.source;

        Posts = db.createCollection('Posts', {
            relations: {
                author: 'Users'
            }
        });
        postsSource = <TestDataSource>Posts.source;

        usersSource.setData([
            {id: 1, name: 'user 1'},
            {id: 2, name: 'user 2'}
        ], false);

        let posts = [];
        for (let i = 0; i < 50; i++) {
            posts.push({
                text: `post ${i + 1}`,
                author_id: i % 2 === 0 ? 1 : 2
            });
        }

        postsSource.setData(posts);
    });

    describe('CollectionView', () => {
        let view:CollectionView;

        afterEach('dispose view', () => {
            view.dispose();
        });

        it('contains filtered items', () => {
            view = new CollectionView(Posts, {
                where: {
                    text: {$like: 'post 1%'}
                },
                orderBy: 'text',
                loadImmediately: false,
            });

            let loaded = view.load();

            expect(view.loading).to.be.true;
            expect(view.items).to.not.exist;

            expect(postsSource.pendingRequests.length).to.equal(1);
            postsSource.pendingRequests[0].respond();

            return loaded.then(() => {
                expect(view.loading).to.be.false;

                expect(view.items.length).to.equal(11);

                expect(view.items[0]['text']).to.equal('post 1');
                expect(view.items[10]['text']).to.equal('post 19');
            });
        });

        it('updates items when query is updated', () => {
            view = new CollectionView(Posts, {
                orderBy: 'text',
                loadImmediately: false,
            });

            return postsSource.runAndRespond(() => {
                return view.load();
            }).then(() => {
                expect(view.items.length).to.equal(50);

                view.setQuery({text: {$like: 'post 1%'}}, false);

                return postsSource.runAndRespond(() => view.load());
            }).then(() => {
                expect(view.items.length).to.equal(11);

                expect(view.items[0]['text']).to.equal('post 1');
                expect(view.items[10]['text']).to.equal('post 19');
            });
        });

        it('updates items when new item is added to collection', () => {
            view = new CollectionView(Posts, {
                where: {
                    text: {$like: 'post 1%'}
                },
                orderBy: 'text',
                loadImmediately: false,
            });

            return postsSource.runAndRespond(() => {
                return view.load();
            }).then(() => {
                expect(view.items.length).to.equal(11);

                return postsSource.runAndRespond(() =>
                        Posts.create({text: 'post 101', author_id: 1})
                );
            }).then(() => {
                expect(view.items.length).to.equal(12);
                expect(view.items[2]['text']).to.equal('post 101');
            });
        });

        it("doesn't go in race condition in load() when changing query while " +
            "loading", () => {
            view = new CollectionView(Posts, {
                where: {
                    text: 'post 10'
                },
                orderBy: 'text',
                loadImmediately: false,
            });

            let firstLoaded = view.load();
            let loadingPendingRequest = postsSource.pendingRequests[0];
            expect(loadingPendingRequest).to.exist;

            view.setQuery({text: 'post 20'}, false);

            return postsSource.runAndRespond(() => {
                return view.load();
            }).then(() => {
                loadingPendingRequest.respond();
                return firstLoaded;
            }).then(() => {
                expect(view.items.length).to.equal(1);
                expect(view.items[0]['text']).to.equal('post 20');
            });
        });

        it("doesn't go in race condition in load() when item in collection " +
            "is replaced while loading relations", () => {
            view = new CollectionView(Posts, {
                where: {
                    text: 'post 10'
                },
                orderBy: 'text',
                loadImmediately: false,
                fetchOptions: {
                    loadRelations: {
                        author: true
                    }
                }
            });
            let post = postsSource.data.find(item => item.text === 'post 10');

            let firstLoaded = view.load();

            let loadingPendingRequest = postsSource.pendingRequests[0];
            expect(loadingPendingRequest).to.exist;
            loadingPendingRequest.respond();

            // let `insterted` binding of CollectionView request `author`
            // relation
            return pause().then(() => {
                return postsSource.runAndRespond(() => {
                    return Posts.update(post.id, {extra: 42});
                })
            }).then(() => {
                let loadingRelationsPendingRequest =
                    usersSource.pendingRequests[0];
                expect(loadingRelationsPendingRequest).to.exist;
                loadingRelationsPendingRequest.respond();
                return firstLoaded;
            }).then(() => {
                return pause()
            }).then(() => {
                console.log('here');
                expect(view.items.length).to.equal(1);
                expect(view.items[0]['extra']).to.equal(42);
            });
        });

        it("doesn't go in race condition on loading relations for inserted " +
            "item", () => {
            view = new CollectionView(Posts, {
                where: {
                    text: 'post 101'
                },
                orderBy: 'text',
                loadImmediately: false,
                fetchOptions: {
                    loadRelations: {
                        author: true
                    }
                }
            });

            let createdPostId;

            return postsSource.runAndRespond(() => {
                return view.load();
            }).then(() => {
                expect(view.items.length).to.equal(0);
                expect(postsSource.pendingRequests.length).to.equal(0);

                Posts.create({text: 'post 101', author_id: 1}).then((post) => {
                    createdPostId = post.pk;
                });
                expect(postsSource.pendingRequests.length).to.equal(1);
                postsSource.pendingRequests[0].respond();

                // let `insterted` binding of CollectionView request `author`
                // relation
                return pause();
            }).then(() => {
                expect(usersSource.pendingRequests.length).to.equal(1);
                expect(createdPostId).to.exist;

                let authorLoadingPending = usersSource.pendingRequests[0];

                Posts.update(createdPostId, {author_id: 2});
                expect(postsSource.pendingRequests.length).to.equal(1);
                postsSource.pendingRequests[0].respond();

                return pause().then(() => {
                    expect(usersSource.pendingRequests.length).to.equal(2);

                    usersSource.pendingRequests[1].respond();

                    return pause();
                }).then(() => {
                    expect(view.items.length).to.equal(1);
                    expect(view.items[0]['author_id']).to.equal(2);

                    authorLoadingPending.respond();

                    return pause();
                }).then(() => {
                    expect(view.items.length).to.equal(1);
                    expect(view.items[0]['author_id']).to.equal(2);
                });
            });
        });

        it('loads eager-loaded relations for inserted items', () => {
            Posts.relations.get('author').eagerLoad = true;

            view = new CollectionView(Posts, {
                where: {
                    text: 'post 101'
                },
                orderBy: 'text',
                loadImmediately: false
            });

            return postsSource.runAndRespond(() => {
                return view.load();
            }).then(() => {
                Posts.create({text: 'post 101', author_id: 1});
                expect(postsSource.pendingRequests.length).to.equal(1);
                postsSource.pendingRequests[0].respond();

                // let `insterted` binding of CollectionView request `author`
                // relation
                return pause();
            }).then(() => {
                expect(usersSource.pendingRequests.length).to.equal(1);
                usersSource.pendingRequests[0].respond();

                return pause();
            }).then(() => {
                expect(view.items.length).to.equal(1);
                expect(view.items[0]['author']['name']).to.equal('user 1');
            });
        });
    });
});