const http = require('node:http');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const metroEnhanceMiddleware = config.server.enhanceMiddleware;

config.server.enhanceMiddleware = (metroMiddleware, metroServer) => {
  const enhancedMetroMiddleware = metroEnhanceMiddleware
    ? metroEnhanceMiddleware(metroMiddleware, metroServer)
    : metroMiddleware;

  return (request, response, next) => {
    const requestUrl = request.url ?? '/';
    if (!requestUrl.startsWith('/api/')) {
      return enhancedMetroMiddleware(request, response, next);
    }

    const upstreamPath = requestUrl.slice('/api'.length);
    const proxyRequest = http.request(
      {
        hostname: '127.0.0.1',
        port: 3000,
        method: request.method,
        path: upstreamPath,
        headers: { ...request.headers, host: '127.0.0.1:3000' },
      },
      (proxyResponse) => {
        response.writeHead(proxyResponse.statusCode ?? 502, proxyResponse.headers);
        proxyResponse.pipe(response);
      },
    );

    proxyRequest.on('error', (error) => {
      if (!response.headersSent) {
        response.writeHead(502, { 'content-type': 'application/json' });
      }
      response.end(JSON.stringify({ error: 'API local indisponível.', detail: error.message }));
    });

    request.pipe(proxyRequest);
    return undefined;
  };
};

module.exports = config;
