var express       = require('express');
var bodyParser    = require('body-parser');
var request       = require('request');
var dotenv        = require('dotenv');
var SpotifyWebApi = require('spotify-web-api-node');

dotenv.load();

// Get Spotify keys
var spotifyApi = new SpotifyWebApi({
    clientId     : process.env.SPOTIFY_KEY,
    clientSecret : process.env.SPOTIFY_SECRET,
    redirectUri  : process.env.SPOTIFY_REDIRECT_URI
});

// Send messages back to slack
function slack(res, message) {
    if (process.env.SLACK_OUTGOING === 'true') {
        return res.send(JSON.stringify({text: message}));
    } else {
        return res.send(message);
    }
}

var app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
    extended: true
}));

// Main page with an authorisation button
app.get('/', function(req, res) {
    if (spotifyApi.getAccessToken()) {
        return res.send('You are logged in.');
    }
    return res.send('<a href="/authorise">Authorise</a>');
});

// Main authorisation route
app.get('/authorise', function(req, res) {
    var scopes = ['playlist-modify-public', 'playlist-modify-private'];
    var state  = new Date().getTime();
    var authoriseURL = spotifyApi.createAuthorizeURL(scopes, state);
    res.redirect(authoriseURL);
});

// Callback route for authorisation
app.get('/callback', function(req, res) {
    spotifyApi.authorizationCodeGrant(req.query.code)
        .then(function(data) {
            spotifyApi.setAccessToken(data.body['access_token']);
            spotifyApi.setRefreshToken(data.body['refresh_token']);
            return res.redirect('/');
        }, function(err) {
            return res.send(err);
        });
});

app.use('/store', function(req, res, next) {
    if (req.body.token !== process.env.SLACK_TOKEN) {
        return slack(res.status(500), 'Cross site request forgerizzle!');
    }
    next();
});

// Main processing route
app.post('/store', function(req, res) {
    // Refresh authorisation token
    spotifyApi.refreshAccessToken()
        .then(function(data) {
            // If successful, assign the new token
            spotifyApi.setAccessToken(data.body['access_token']);
            if (data.body['refresh_token']) {
                spotifyApi.setRefreshToken(data.body['refresh_token']);
            }

            let text = req.body.text;
            let mySplitText = text.split(" ");
            let noKeywordText = mySplitText.shift().join(" ");
            // /ml find song to return top result

            if (mySplitText[0] === "find") {
              spotifyApi.searchTracks("track:" + text)
                .then(function(data) {
                    let queryResult = data.body.tracks.items;
                    if (queryResult.length === 0) {
                      return slack(res, "No results");
                    }
                    return slack(res, "Result: " + queryResult[0].name + " by " + queryResult[0].artists[0].name)
                  },                
                function(err) {
                  console.log("Error " + err);
                }
              )
            }
``
            // If command is empty, provide the user with instructions
            if (req.body.text.trim().length === 0) {
                return res.send('Enter the name of a song and the name of the artist, separated by a "-"\nExample: Blue (Da Ba Dee) - Eiffel 65');
            }

            // If there was no - separator, use the whole query as a song name
            if(text.indexOf(' - ') === -1) {
                var query = 'track:' + text;
            } else {
                // Otherwise use the first part for an artist name and the second for a song name
                var pieces = text.split(' - ');
                var query = 'artist:' + pieces[0].trim() + ' track:' + pieces[1].trim();
            }

            /* query is now either
            "track:Song name"
            or 
            "artist:Artist nametrack:Song name"

            */
            spotifyApi.searchTracks(query)
                .then(function(data) {
                    // If request for song successful, assign the results to the results variable
                    var results = data.body.tracks.items;
                    // If results array empty, search did not return any songs
                    if (results.length === 0) {
                        return slack(res, 'Could not find that track.');
                    }
                    // Otherwise, assign the top result to track variable
                    var track = results[0];
                    // User spotifyApi to add the found track to the playlist
                    spotifyApi.addTracksToPlaylist(process.env.SPOTIFY_USERNAME, process.env.SPOTIFY_PLAYLIST_ID, ['spotify:track:' + track.id])
                        .then(function(data) {
                            // Return the song name if successful
                            var message = 'Track added' + (process.env.SLACK_OUTGOING === 'true' ? ' by *' + req.body.user_name + '*' : '') + ': *' + track.name + '* by *' + track.artists[0].name + '*'
                            return slack(res, message);
                        }, function(err) {
                            return slack(res, err.message);
                        });
                }, function(err) {
                    return slack(res, err.message);
                });
        }, function(err) {
            return slack(res, 'Could not refresh access token. You probably need to re-authorise yourself from your app\'s homepage.');
        });
});

app.set('port', (process.env.PORT || 5000));
app.listen(app.get('port'));
console.log("Listening...");
