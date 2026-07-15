import { useHasActiveWorkspace } from '@/business/client/hooks/useHasActiveWorkspace';
import { useClientDataSWR } from '@/libs/swr';
import type { PermissionResourceType } from '@/services/resourcePermission';
import { resourcePermissionService } from '@/services/resourcePermission';

// Same SWR key as useResourcePermission so both hooks share one fetch/cache entry.
const FETCH_RESOURCE_PERMISSION_KEY = 'resource-permission';

/**
 * Read-side derivation of the workspace General-access level for a resource.
 *
 * Permissive by default: personal mode (no active workspace), loading, and
 * error states all report full access — never flash disabled UI while the
 * level is still unknown; the server remains the enforcement point. Creator
 * and workspace owner (`canManage`) always keep full edit/use rights
 * regardless of the configured access level.
 */
export const useResourceAccess = (
  resourceType: PermissionResourceType,
  resourceId: string | undefined,
) => {
  const hasActiveWorkspace = useHasActiveWorkspace();
  const enabled = hasActiveWorkspace && !!resourceId;

  const { data, isLoading } = useClientDataSWR(
    enabled ? [FETCH_RESOURCE_PERMISSION_KEY, resourceType, resourceId] : null,
    () => resourcePermissionService.getGeneralAccess(resourceType, resourceId!),
  );

  return {
    canEditResource: !enabled || !data ? true : data.canManage || data.accessLevel === 'edit',
    canUseResource: !enabled || !data ? true : data.canManage || data.accessLevel !== 'view',
    isLoading,
  };
};
