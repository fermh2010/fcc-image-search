'use strict';

const express = require('express');
const app = express();
const https = require('https');
const mongo = require('mongodb').MongoClient;
const concat = require('concat-stream');

const db_url = process.env.MONGOLAB_URI || 'mongodb://localhost:27017/database';
const db_searches_collection_name = 'image_searches';

app.set('port', process.env.PORT || 8080);

app.use(require('response-time')());

app.get('/api/imagesearch/:query', function(req, res, next) {
    let offset = 0;
    if(req.query.hasOwnProperty('offset')) {
        offset = Number(req.query.offset);
        if(offset < 0)
            offset = 0;
    }
    
    let url = getCSEApiEndpoint(req.params.query, offset);
    https.get(url, function(data) {
        data.setEncoding('utf8');
        data.on('error', function(err) {
            next(err);
        })
        data.pipe(concat(function(json) {
            res.json(buildSearchJsonOut(json));
            next(); // log search in db middleware
        }));
    }).on('error', function(err) {
        next(err);
    });
}, function(req, res, next) {
    // search ok, log search in db
    mongo.connect(db_url, function(err, db) {
        if(err) 
            return next(err);
            
        let searches = db.collection(db_searches_collection_name);
        searches.insertOne({
            query: req.params.query,
            timestamp: new Date().getTime()
        }, function(err, r) {
            if(err)
                console.log(err);
            
            db.close();
        });
    });
});

function getCSEApiEndpoint(query, offset) {
    return 'https://www.googleapis.com/customsearch/v1?parameters'
    + '&key=AIzaSyCxe6cIxydE1qn9TN_kK9XUvydX3_ENv-U'
    + '&cx=015333894188476200064:3_j_uyphlh8'
    + '&searchType=image'
    + '&fields=queries(nextPage,previousPage),items(title,link,snippet,image(contextLink,thumbnailLink))'
    + '&num=' + 10
    + '&start=' + (offset + 1)
    + '&q=' + query;
}

function buildSearchJsonOut(data) {
    let out = [];
    let jsonIn;
    
    try {
        jsonIn = JSON.parse(data);
    } catch(err) {
        console.log(err);
        return out;
    }

    if(jsonIn.hasOwnProperty('items')) {
        let items = jsonIn.items;
        for(let i = 0; i < items.length; ++i) {
            let item = items[i];
            let image = {};
            image.url = item.link;
            image.snippet = item.snippet;
            image.thumbnail = item.image.thumbnailLink;
            image.context = item.image.contextLink;
            out.push(image);
        }
    }
    
    return out;
}

app.get('/api/latest/imagesearch', function(req, res, next) {
    mongo.connect(db_url, function(err, db) {
        if(err)
            return next(err);
        
        db.collection(db_searches_collection_name, 
            { strict: true }, // don't create collection if it does not exist
            function(err, collection) {
                if(!err) {
                    collection.find({}, {
                        _id: 0
                    }).limit(10)
                    .sort({ timestamp: -1 })
                    .toArray(function(err, docs) {
                        let out = [];
                        if(err) {
                            console.log(err);
                        } else if(docs) {
                            docs.forEach(function(doc) {
                                let item = {};
                                item.term = doc.query;
                                item.when = new Date(doc.timestamp).toUTCString();
                                out.push(item);
                            });
                        }
                        
                        db.close();
                        res.json(out);
                    });
                } else {
                    db.close();
                    res.json([]);
                }
            }
        );
    });
});

app.listen(app.get('port'), function() {
    console.log('Server up');
});