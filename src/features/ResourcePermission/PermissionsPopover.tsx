'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, type DropdownItem, DropdownMenu } from '@lobehub/ui/base-ui';
import {
  CheckIcon,
  ChevronDownIcon,
  EyeIcon,
  type LucideIcon,
  PencilIcon,
  PlayIcon,
  UsersIcon,
} from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { PermissionResourceType, ResourceAccessLevel } from '@/services/resourcePermission';

import { useResourcePermission } from './useResourcePermission';

export interface PermissionsPopoverProps {
  resourceId?: string;
  resourceType: PermissionResourceType;
}

/**
 * Header entry for configuring the access level granted to workspace members.
 * Resource visibility is managed separately by the resource list.
 */
const PermissionsPopover = memo<PermissionsPopoverProps>(({ resourceId, resourceType }) => {
  const { t } = useTranslation('setting');
  const { data, error, isLoading, setAccessLevel, updating } = useResourcePermission(
    resourceType,
    resourceId,
  );

  const accessOptions = useMemo(() => {
    const levels: {
      desc: string;
      icon: LucideIcon;
      label: string;
      value: ResourceAccessLevel;
    }[] = [
      {
        desc: t(
          resourceType === 'document'
            ? 'permission.generalAccess.editableDocumentDesc'
            : 'permission.generalAccess.editableDesc',
        ),
        icon: PencilIcon,
        label: t('permission.generalAccess.editable'),
        value: 'edit',
      },
    ];
    if (resourceType !== 'document') {
      levels.push({
        desc: t('permission.generalAccess.usableDesc'),
        icon: PlayIcon,
        label: t('permission.generalAccess.usable'),
        value: 'use',
      });
    }
    levels.push({
      desc: t(
        resourceType === 'document'
          ? 'permission.generalAccess.viewableDocumentDesc'
          : 'permission.generalAccess.viewableDesc',
      ),
      icon: EyeIcon,
      label: t('permission.generalAccess.viewable'),
      value: 'view',
    });
    return levels;
  }, [resourceType, t]);

  const accessLevel = data?.accessLevel;
  const canManage = data?.canManage ?? false;
  const selectedOption = accessOptions.find((option) => option.value === accessLevel);
  const items = useMemo<DropdownItem[]>(
    () =>
      error
        ? [
            {
              disabled: true,
              key: 'error',
              label: (error as Error)?.message || t('permission.loadFailed'),
            },
          ]
        : accessOptions.map(({ desc, icon, label, value }) => ({
            desc,
            disabled: !canManage || updating,
            icon,
            key: value,
            label: (
              <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
                <span>{label}</span>
                {value === accessLevel && <CheckIcon size={16} />}
              </Flexbox>
            ),
            onClick: () => {
              if (updating || value === accessLevel) return;
              void setAccessLevel(value);
            },
          })),
    [accessLevel, accessOptions, canManage, error, setAccessLevel, t, updating],
  );

  return (
    <DropdownMenu
      iconAlign={'center'}
      items={items}
      placement={'bottomRight'}
      triggerProps={{ disabled: isLoading }}
      popupProps={{
        style: {
          maxWidth: 320,
          minWidth: 300,
        },
      }}
    >
      <Button
        icon={UsersIcon}
        loading={isLoading}
        size={'small'}
        title={!canManage && data ? t('permission.noManagePermission') : undefined}
        type={'fill'}
      >
        <Flexbox horizontal align={'center'} gap={6}>
          {selectedOption
            ? t('permission.generalAccess.trigger', { level: selectedOption.label })
            : t('permission.generalAccess.label')}
          <ChevronDownIcon size={14} />
        </Flexbox>
      </Button>
    </DropdownMenu>
  );
});

export default PermissionsPopover;
