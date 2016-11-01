'use strict';

const express = require('express');
const app = express();
const https = require('https');
const mongo = require('mongodb');
const co = require('co');
const concat = require('concat-stream');

const db_url = process.env.MONGOLAB_URI || 'mongodb://localhost:27017/database';
const db_searches_collection_name = 'image_searches';

console.log(mongo);

app.set('port', process.env.PORT || 8080);

app.use(require('response-time')());

app.get('/api/imagesearch/:query', searchImages, logSearch);

app.get('/api/latest/imagesearch', latestSearches);

app.listen(app.get('port'), function() {
    console.log('Server up');
});

function searchImages(req, res, next) {
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
}

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

function logSearch(req, res, next) {
    // search ok, log search in db
    let db;
    co(function*() {
        db = yield mongo.connect(db_url);
        let searches = db.collection(db_searches_collection_name);
        return yield searches.insertOne({
            query: req.params.query,
            timestamp: new Date().getTime()
        });
    })
    .catch(function(err) {
        console.log('Could not log search: ' + err);
    })
    .then(function() {
        if(db)
            db.close();
    });
}

function latestSearches(req, res, next) {
    let db;
    co(function*() {
        db = yield mongo.connect(db_url);
        
        let collection = db.collection(db_searches_collection_name);
        
        let docs = yield collection.find({}, { _id: 0 })
                            .limit(10)
                            .sort({ timestamp: -1 })
                            .toArray();
        
        return docs.map(doc => ({ 
            term: doc.query,
            when: new Date(doc.timestamp).toUTCString()
        }));
    })
    .then(function(r) {
        res.json(r);
    })
    .catch(function(err) {
        console.log(err);
        res.status(500).json([]);
    })
    .then(function() {
        if(db)
            db.close();
    })
    .catch(function(err) {
       console.log(err) ;
    });
}