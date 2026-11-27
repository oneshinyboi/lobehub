import type { RouteObject } from 'react-router';

import { dynamicElement } from '@/utils/router';

/**
 * Business routes that expect the cloud overlay. The self-hosted build
 * registers the invitation landing page here: it must render outside the main
 * layout, because a signed-out visitor has no workspace context yet.
 *
 * `/invite` is already a reserved root segment (`rootSegments.ts`) and is
 * deferred by the onboarding redirect (`useUserStateRedirect.ts`), so arriving
 * here never bounces through either the workspace-slug tree or onboarding.
 */
export const BusinessDesktopRoutesWithMainLayout: RouteObject[] = [];

export const BusinessDesktopRoutesWithSettingsLayout: RouteObject[] = [];

export const BusinessDesktopRoutesWithoutMainLayout: RouteObject[] = [
  {
    element: dynamicElement(
      () => import('@/routes/(main)/invite/[token]'),
      'Desktop > Invite Accept',
    ),
    path: '/invite/:token',
  },
];

export const BusinessResourceRoutes: RouteObject[] = [];
