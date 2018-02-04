# usage
1. Prepare node environment (for example v8.9.3 from nodebrew)
2. Prepare MongoDB (for example mongo on docker)
3. clone this repository
4. build and run:

   ```
   cp config.json.example config.json
   vi config.json # zaif api key, ifttt api key, mongodb location
   npm install
   npm run build; node index.js
   ```
