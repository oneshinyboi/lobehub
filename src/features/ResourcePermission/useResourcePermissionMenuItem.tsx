import { Flexbox, Icon, type MenuProps } from '@lobehub/ui';
import { CheckIcon, EyeIcon, type LucideIcon, PencilIcon, PlayIcon, UsersIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { PermissionResourceType, ResourceAccessLevel } from '@/services/resourcePermission';

import { useResourcePermission } from './useResourcePermission';

type MenuItem = NonNullable<MenuProps['items']>[number];

export const useResourcePermissionMenuItem = (
  resourceType: PermissionResourceType,
  resourceId?: string,
): MenuItem | null => {
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

  if (!resourceId) return null;

  const accessLevel = data?.accessLevel;
  const canManage = data?.canManage ?? false;
  const selectedOption = accessOptions.find((option) => option.value === accessLevel);

  return {
    children: accessOptions.map(({ desc, icon, label, value }) => ({
      desc,
      disabled: !canManage || updating,
      icon: <Icon icon={icon} />,
      key: `member-permission-${value}`,
      label: (
        <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
          <span>{label}</span>
          {value === accessLevel && <Icon icon={CheckIcon} />}
        </Flexbox>
      ),
      onClick: () => {
        if (updating || value === accessLevel) return;
        void setAccessLevel(value);
      },
    })),
    disabled: isLoading || !!error,
    icon: <Icon icon={UsersIcon} />,
    key: 'member-permissions',
    label: selectedOption
      ? t('permission.generalAccess.trigger', { level: selectedOption.label })
      : t('permission.generalAccess.label'),
  };
};
