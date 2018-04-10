/* eslint import/no-extraneous-dependencies: ["error", {"devDependencies": true}] */
/* eslint no-console: 0, import/no-unresolved: 0 */
const express = require('express');
const session = require('express-session');
const jwtDecode = require('jwt-decode');
const simpleOauthModule = require('simple-oauth2');
const Client = require('../lib/client');

const CLIENT_ID = '415db3c6-e149-41e7-9b6e-96299f4a1b55';
/* Cerner does not currently support using a client secret. Public launch only.*/
const CLIENT_SECRET = 'keyboard cat';
const LOCAL_HOST = 'http://localhost:3000';
const app = express();

// Use session to pass the iss information to the callback
app.use(session({
  secret: CLIENT_SECRET,
  cookie: { maxAge: 60000 },
  resave: true,
  saveUninitialized: true,
}));


/**
 * This is an exmple of a SMART app launching from within an EHR.
 *
 * In this example, there are two routes:
 *  - /launch
 *  - /callback
 *
 *
 * The EHR will call the launch route with two parameters: iss and launch. The
 * SMART app will will make a request to the OAuth server's authorization URL.
 * Then will redirect to the SMART app callback.
 *
 * In the callback route, another request is made (using the simple-oauth
 * library) to request a token from the OAuth2 server. The server will then
 * send back a launch_context containing among other things an access token to
 * set in the Authorization header and use for subsequent FHIR requests (to the
 * ISS).
 */
app.get('/launch', async (req, res) => {
  console.log('*** Incoming Request ***');
  console.log('** Headers **');
  console.log(req.headers);
  console.log('** Query **');
  console.log(req.query);
  const { iss, launch } = req.query;

  const fhirClient = new Client({ baseUrl: iss });
  const response = await fhirClient.smartAuthMetadata()
    .catch(error => console.log(`$$$$ Error: ${error}`));
  const { tokenUrl, authorizeUrl } = response;

  console.log('*** Received OAuth urls ***');
  console.log(`authorize: ${authorizeUrl}`);
  console.log(`token: ${tokenUrl}`);
  req.session.iss = iss;

  // Create a new oAuth2 object using the Client capability statement:
  const oauth2 = simpleOauthModule.create({
    client: {
      id: CLIENT_ID,
      /* Cerner does not currently support using a client secret. Public launch only.*/
      // secret: CLIENT_SECRET,
    },
    auth: {
      tokenHost: `${tokenUrl.protocol}//${tokenUrl.host}`,
      tokenPath: tokenUrl.pathname,
      authorizeHost: `${authorizeUrl.protocol}//${authorizeUrl.host}`,
      authorizePath: authorizeUrl.pathname,
    },
  });

  // Authorization uri definition
  console.log(`Redirect URI: ${LOCAL_HOST}/callback`);
  const authorizationUri = oauth2.authorizationCode.authorizeURL({
    /* TODO: Investigate why the sandbox doesn't work if you pass a redirect_uri */
    // redirect_uri: `${LOCAL_HOST}/callback`,
    launch,
    aud: iss,
    scope: 'launch openid profile user/Patient.read user/Observation.read user/Practitioner.read',
    state: '3(#0/!~',
  });

  res.redirect(authorizationUri);
});

// Callback service parsing the authorization token and asking for the access token
app.get('/callback', async (req, res) => {
  const { iss } = req.session;
  console.log(req.session);

  const fhirClient = new Client({ baseUrl: iss });
  const response = await fhirClient.smartAuthMetadata()
        .catch(error => console.log(`$$$$ Error: ${error}`));
  const { tokenUrl, authorizeUrl } = response;
  // const { authorizeUrl, tokenUrl } = await fhirClient.smartAuthMetadata();

  // Create a new oAuth2 object using the Client capability statement:
  const oauth2 = simpleOauthModule.create({
    client: {
      id: CLIENT_ID,
      /* Cerner does not currently support using a client secret. Public launch only.*/
      // secret: CLIENT_SECRET,
    },
    auth: {
      tokenHost: `${tokenUrl.protocol}//${tokenUrl.host}`,
      tokenPath: tokenUrl.pathname,
      authorizeHost: `${authorizeUrl.protocol}//${authorizeUrl.host}`,
      authorizePath: authorizeUrl.pathname,
    },
  });

  const { code } = req.query;
  const options = {
    code,
  };

  try {
    const result = await oauth2.authorizationCode.getToken(options);

    const { token } = oauth2.accessToken.create(result);

    console.log('The token is : ', token);

    fhirClient.bearerToken = token.access_token;

    // /* Get current Patient */
    // const patient = await fhirClient.read({ resourceType: 'Patient', id: token.patient });
    // return res.status(200).json(patient);

    // /* Get Patient weight
    //  * Cerner does not appear to support sorting by date.
    //  * Requesting one Observation appears to return the most recent.
    //  */
    // const observations = await fhirClient.search({
    //   resourceType: 'Observation',
    //   searchParams: {
    //     patient: `Patient/${token.patient}`,
    //     code: 'http://loinc.org|3141-9',
    //     _count: 1,
    //   }
    // });
    // return res.status(200).json(observations);

    // /* Get current User */
    // const idToken = jwtDecode(token.id_token);
    // console.log(`Current User Name: ${idToken.name}`)
    // const user = await fhirClient.resolve(idToken.profile);
    // return res.status(200).json(user);
  } catch (error) {
    console.error('Access Token Error', error.message);
    console.log(error);
    return res.status(500).json('Authentication failed');
  }
});

app.listen(3000, () => {
  console.log('Express server started on port 3000');
});

