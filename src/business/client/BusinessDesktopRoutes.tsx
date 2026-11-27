// The invitation landing page is a self-hosted surface. Registering it through
// the business-route seam keeps every existing route table untouched, which is
// what the cloud overlay does for its own standalone routes.
export * from '@/selfhosted/client/features/InviteAccept/routes';
