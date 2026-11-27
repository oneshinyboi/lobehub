'use client';

import type { WorkspaceAuditLogItem } from '@lobechat/database/schemas';
import {
  Button,
  cssVar,
  DateRangePicker,
  Empty,
  Flexbox,
  Icon,
  SearchBar,
  Select,
  Tag,
  Text,
} from '@lobehub/ui';
import dayjs from 'dayjs';
import { RotateCcw } from 'lucide-react';
import { type CSSProperties, memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';

import { AUDIT_ACTIONS, AUDIT_RESOURCE_TYPES } from './const';
import { type AuditLogFilters, useWorkspaceAuditLog } from './useWorkspaceAuditLog';

const SEARCH_DEBOUNCE_MS = 300;

const DATE_FORMAT = 'YYYY-MM-DD HH:mm:ss';

const cellStyle: CSSProperties = {
  color: cssVar.colorText,
  fontSize: 12,
  minWidth: 0,
};

const headerCellStyle: CSSProperties = {
  color: cssVar.colorTextSecondary,
  fontSize: 12,
};

const rowStyle: CSSProperties = {
  alignItems: 'center',
  borderRadius: cssVar.borderRadius,
  display: 'grid',
  gap: 12,
  gridTemplateColumns: '168px 220px 200px 140px 220px 130px',
  minWidth: 1110,
  paddingBlock: 10,
  paddingInline: 12,
};

const headerRowStyle: CSSProperties = {
  ...rowStyle,
  paddingBlock: 4,
};

const scrollStyle: CSSProperties = {
  overflowX: 'auto',
  width: '100%',
};

/**
 * `t` with `defaultValue` is typed as `string | TFunctionDetailedResult`, so
 * `String(...)` keeps both the label helper and the JSX/Select `label` slots
 * honest without a cast at every call site.
 */
const useAuditLabels = () => {
  const { t } = useTranslation('setting');

  const actionLabel = useCallback(
    (action: string) => String(t(`workspace.auditLog.actions.${action}`, { defaultValue: action })),
    [t],
  );

  const resourceTypeLabel = useCallback(
    (resourceType: string) =>
      String(t(`workspace.auditLog.resourceTypes.${resourceType}`, { defaultValue: resourceType })),
    [t],
  );

  return { actionLabel, resourceTypeLabel };
};

const AuditLogRow = memo<{ item: WorkspaceAuditLogItem }>(({ item }) => {
  const { actionLabel, resourceTypeLabel } = useAuditLabels();

  return (
    <div style={rowStyle}>
      <Text style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
        {dayjs(item.createdAt).format(DATE_FORMAT)}
      </Text>
      <Text ellipsis style={{ ...cellStyle, fontSize: 13 }}>
        {actionLabel(item.action)}
      </Text>
      <Text ellipsis style={cellStyle} type={'secondary'}>
        {item.userId ?? '-'}
      </Text>
      <span>
        {item.resourceType ? (
          <Tag>{resourceTypeLabel(item.resourceType)}</Tag>
        ) : (
          <Text type={'secondary'}>-</Text>
        )}
      </span>
      <Text ellipsis style={cellStyle} type={'secondary'}>
        {item.resourceId ?? '-'}
      </Text>
      <Text style={cellStyle} type={'secondary'}>
        {item.ipAddress ?? '-'}
      </Text>
    </div>
  );
});

AuditLogRow.displayName = 'WorkspaceAuditLogRow';

const AuditLogHeader = memo(() => {
  const { t } = useTranslation('setting');

  return (
    <div style={headerRowStyle}>
      <span style={headerCellStyle}>{t('workspace.auditLog.columns.time')}</span>
      <span style={headerCellStyle}>{t('workspace.auditLog.columns.action')}</span>
      <span style={headerCellStyle}>{t('workspace.auditLog.columns.operator')}</span>
      <span style={headerCellStyle}>{t('workspace.auditLog.columns.resourceType')}</span>
      <span style={headerCellStyle}>{t('workspace.auditLog.columns.resourceId')}</span>
      <span style={headerCellStyle}>{t('workspace.auditLog.columns.ip')}</span>
    </div>
  );
});

AuditLogHeader.displayName = 'WorkspaceAuditLogHeader';

/**
 * Workspace Settings → Audit logs. Admin-only at the route (`WorkspaceAdminOnly`)
 * and again on the server (`requireWorkspaceRole('admin')`); this component only
 * shapes the read model: filter bar, cursor pagination and the empty state.
 */
const WorkspaceAuditLog = memo(() => {
  const { t } = useTranslation('setting');
  const { actionLabel, resourceTypeLabel } = useAuditLabels();
  const workspaceId = useActiveWorkspaceId();

  const [searchText, setSearchText] = useState('');
  const [query, setQuery] = useState('');
  const [action, setAction] = useState<string>();
  const [resourceType, setResourceType] = useState<string>();
  const [range, setRange] = useState<[Date, Date] | null>(null);

  // Keep the typed value snappy but avoid one request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(searchText.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText]);

  const filters = useMemo<AuditLogFilters>(
    () => ({
      action,
      // Day-granularity pickers: include the whole end day.
      endDate: range?.[1] ? dayjs(range[1]).endOf('day').toISOString() : undefined,
      q: query || undefined,
      resourceType,
      startDate: range?.[0] ? dayjs(range[0]).startOf('day').toISOString() : undefined,
    }),
    [action, query, range, resourceType],
  );

  const { error, hasMore, isLoading, isLoadingMore, items, loadMore, refresh } =
    useWorkspaceAuditLog(workspaceId, filters);

  const resetFilters = useCallback(() => {
    setSearchText('');
    setQuery('');
    setAction(undefined);
    setResourceType(undefined);
    setRange(null);
  }, []);

  const actionOptions = useMemo(
    () =>
      AUDIT_ACTIONS.map((value) => ({
        label: actionLabel(value),
        value,
      })),
    [actionLabel],
  );

  const resourceTypeOptions = useMemo(
    () =>
      AUDIT_RESOURCE_TYPES.map((value) => ({
        label: resourceTypeLabel(value),
        value,
      })),
    [resourceTypeLabel],
  );

  const renderBody = () => {
    if (error) {
      return (
        <Empty
          action={<Button onClick={refresh}>{t('retry', { ns: 'common' })}</Button>}
          description={t('workspace.auditLog.loadFailed')}
        />
      );
    }

    if (isLoading) return <SkeletonList rows={4} />;

    if (items.length === 0) {
      return <Empty description={t('workspace.auditLog.empty')} style={{ paddingBlock: 40 }} />;
    }

    return (
      <div style={scrollStyle}>
        <AuditLogHeader />
        {items.map((item) => (
          <AuditLogRow item={item} key={item.id} />
        ))}
      </div>
    );
  };

  return (
    <Flexbox gap={16}>
      <Flexbox gap={4}>
        <Text strong fontSize={24}>
          {t('workspace.auditLog.title')}
        </Text>
        <Text type={'secondary'}>{t('workspace.auditLog.desc')}</Text>
      </Flexbox>

      <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
        <SearchBar
          allowClear
          placeholder={t('workspace.auditLog.filters.searchPlaceholder')}
          style={{ width: 240 }}
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
        />
        <Select
          allowClear
          showSearch
          options={actionOptions}
          placeholder={t('workspace.auditLog.filters.allActions')}
          style={{ width: 200 }}
          value={action}
          onChange={(value) => setAction((value as string | undefined) ?? undefined)}
        />
        <Select
          allowClear
          showSearch
          options={resourceTypeOptions}
          placeholder={t('workspace.auditLog.filters.allResourceTypes')}
          style={{ width: 200 }}
          value={resourceType}
          onChange={(value) => setResourceType((value as string | undefined) ?? undefined)}
        />
        <DateRangePicker
          allowClear
          format={'YYYY-MM-DD'}
          style={{ width: 260 }}
          value={range}
          placeholder={[
            t('workspace.auditLog.filters.startDate'),
            t('workspace.auditLog.filters.endDate'),
          ]}
          onChange={(dates) => setRange(dates?.[0] && dates[1] ? [dates[0], dates[1]] : null)}
        />
        <Button icon={<Icon icon={RotateCcw} />} onClick={resetFilters}>
          {t('workspace.auditLog.filters.reset')}
        </Button>
      </Flexbox>

      {renderBody()}

      {hasMore && (
        <Flexbox align={'center'}>
          <Button loading={isLoadingMore} onClick={loadMore}>
            {t('workspace.auditLog.loadMore')}
          </Button>
        </Flexbox>
      )}
    </Flexbox>
  );
});

WorkspaceAuditLog.displayName = 'WorkspaceAuditLog';

export default WorkspaceAuditLog;
