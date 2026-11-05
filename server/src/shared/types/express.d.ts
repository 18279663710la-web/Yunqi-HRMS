import type { CurrentUser } from './models';
import type { AdminUser } from './admin';

declare global {
  namespace Express {
    interface Request {
      user: CurrentUser;
      admin?: AdminUser;
    }
  }
}

export {};
