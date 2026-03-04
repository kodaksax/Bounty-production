/* eslint-env jest */
import { notificationService } from '../../services/notification-service';
import { registerNotificationRoutes } from '../notifications';

describe('API notification routes', () => {
  let routes: Record<string, any>;

  const fastify: any = {
    get: (path: string, _opts: any, handler: any) => { routes[path] = handler; },
    post: (path: string, _opts: any, handler: any) => { routes[path] = handler; },
    delete: (path: string, _opts: any, handler: any) => { routes[path] = handler; },
  };

  beforeEach(async () => {
    routes = {};
    await registerNotificationRoutes(fastify as any);
  });

  function makeReply() {
    const r: any = { statusCode: 200, sent: null };
    r.code = (c: number) => { r.statusCode = c; return r; };
    r.send = (payload: any) => { r.sent = payload; return r; };
    return r;
  }

  test('register-token returns 401 when unauthenticated', async () => {
    const handler = routes['/notifications/register-token'];
    const reply = makeReply();
    await handler({ userId: null, body: {} }, reply);
    expect(reply.statusCode).toBe(401);
    expect(reply.sent).toHaveProperty('error');
  });

  test('register-token rejects invalid token format', async () => {
    const handler = routes['/notifications/register-token'];
    const reply = makeReply();
    await handler({ userId: 'user-1', body: { token: 'not-a-valid-token' } }, reply);
    expect(reply.statusCode).toBe(400);
    expect(reply.sent).toHaveProperty('error');
  });

  test('register-token maps profile errors to profile setup response', async () => {
    const handler = routes['/notifications/register-token'];
    const reply = makeReply();

    jest.spyOn(notificationService, 'registerPushToken').mockRejectedValue(new Error('User profile issue: ...'));

    await handler({ userId: 'user-1', body: { token: 'ExpoPushToken[abc123]' } }, reply);

    expect(reply.statusCode).toBe(500);
    expect(reply.sent).toHaveProperty('error', 'Profile setup error');
  });
});
