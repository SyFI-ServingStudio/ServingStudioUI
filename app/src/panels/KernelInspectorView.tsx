import CloseIcon from '@mui/icons-material/Close';
import { Box, IconButton, Stack, Typography } from '@mui/material';
import { Fragment, type ReactNode } from 'react';

import SurfaceCard from '../ui/controls/SurfaceCard';
import { colorOf, fmtMs, fmtPct, kindLabel, type LeafNode } from './costTreeModel';
import { tokens } from '../ui/theme';
import { scaledQuantity } from '../ui/format';

function Item({
  label,
  value,
  teal,
  valueTitle,
}: {
  label: string;
  value: ReactNode;
  teal?: boolean;
  valueTitle?: string;
}) {
  return (
    <Box
      sx={{
        minWidth: 0,
        display: 'grid',
        gridTemplateColumns: {
          xs: 'minmax(82px,0.7fr) minmax(0,1.3fr)',
        },
        alignItems: 'start',
        gap: 1,
        py: 0.45,
        '&:not(:last-of-type)': { borderBottom: `1px solid ${tokens.hair}` },
      }}
    >
      <Typography
        sx={{
          fontFamily: tokens.body,
          fontSize: 12,
          fontWeight: 650,
          lineHeight: 1.35,
          letterSpacing: 0,
          textTransform: 'none',
          color: tokens.ink,
          pt: 0.15,
        }}
      >
        {label}
      </Typography>
      <Box
        component="div"
        title={valueTitle}
        sx={{
          fontFamily: tokens.body,
          fontSize: 12,
          fontWeight: 500,
          lineHeight: 1.45,
          color: teal ? tokens.teal : tokens.ink,
          wordBreak: 'break-word',
        }}
      >
        {value}
      </Box>
    </Box>
  );
}

function DetailGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box
      component="section"
      sx={{
        p: '9px 11px 7px',
        border: `1px solid ${tokens.hair}`,
        borderRadius: 1.25,
        background: tokens.tile,
      }}
    >
      <Typography
        component="h3"
        sx={{
          mb: 0.2,
          pb: 0.55,
          borderBottom: `1px solid ${tokens.hair}`,
          fontFamily: tokens.serif,
          fontSize: 13,
          fontWeight: 600,
          color: tokens.ink,
        }}
      >
        {title}
      </Typography>
      <Box>{children}</Box>
    </Box>
  );
}

interface DisplayField {
  readonly label: string;
  readonly value: string;
}

function FieldList({ fields }: { fields: readonly DisplayField[] }) {
  return (
    <Box
      component="dl"
      sx={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0,1fr)',
        gap: '3px 8px',
        '& dd': { mb: 0.75 },
        m: 0,
      }}
    >
      {fields.map((field) => (
        <Fragment key={field.label}>
          <Typography
            component="dt"
            sx={{
              fontFamily: tokens.body,
              fontSize: 12,
              fontWeight: 600,
              color: tokens.sub,
            }}
          >
            {field.label}
          </Typography>
          <Typography
            component="dd"
            sx={{
              m: 0,
              fontFamily: tokens.body,
              fontSize: 12,
              fontWeight: 500,
              color: tokens.ink,
            }}
          >
            {field.value}
          </Typography>
        </Fragment>
      ))}
    </Box>
  );
}

const FLOP_SCALES = [
  { divisor: 1e15, unit: 'PFLOP' },
  { divisor: 1e12, unit: 'TFLOP' },
  { divisor: 1e9, unit: 'GFLOP' },
  { divisor: 1e6, unit: 'MFLOP' },
  { divisor: 1, unit: 'FLOP' },
] as const;

const BYTE_SCALES = [
  { divisor: 1e12, unit: 'TB' },
  { divisor: 1e9, unit: 'GB' },
  { divisor: 1e6, unit: 'MB' },
  { divisor: 1e3, unit: 'KB' },
  { divisor: 1, unit: 'B' },
] as const;

function humanFieldLabel(key: string): string {
  if (/^[mnk]$/.test(key)) return key.toUpperCase();
  const labels: Readonly<Record<string, string>> = {
    backends: 'Backends',
    gpu_name: 'GPU',
    dtype: 'Data type',
  };
  return labels[key] ?? key.replace(/_/g, ' ');
}

function humanScalar(value: unknown): string {
  if (typeof value === 'string') {
    const fp8 = /^fp8[_-]?(e\d+m\d+)$/i.exec(value);
    return fp8 === null ? value : `FP8 ${fp8[1].toUpperCase()}`;
  }
  if (typeof value === 'number') return value.toLocaleString();
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (value === null) return 'none';
  if (Array.isArray(value)) return value.map(humanScalar).join(', ');
  return JSON.stringify(value);
}

function configValue(value: unknown): string {
  if (typeof value === 'object' && value !== null && !Array.isArray(value) && 'value' in value) {
    const dim = value as { value: unknown; expression?: unknown };
    const folded = humanScalar(dim.value);
    return typeof dim.expression === 'string' && dim.expression.length > 0
      ? `${dim.expression} = ${folded}`
      : folded;
  }
  return humanScalar(value);
}

function configFields(config: Readonly<Record<string, unknown>>): readonly DisplayField[] {
  return Object.entries(config).map(([key, value]) => ({
    label: humanFieldLabel(key),
    value: configValue(value),
  }));
}

function inputFields(node: LeafNode): readonly DisplayField[] {
  const input = node.stats.input;
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return [];
  return Object.entries(input).map(([key, value]) => ({
    label: humanFieldLabel(key),
    value: humanScalar(value),
  }));
}

export function KernelInspectorView({
  node,
  height,
  closeLabel,
  onClose,
}: {
  node: LeafNode;
  height: number | string;
  closeLabel: string;
  onClose: () => void;
}) {
  const slot = node.slot;
  const color = colorOf(slot.kind);
  const decodedConfig = configFields(slot.kernelConfig);
  const decodedInput = inputFields(node);
  const flops = scaledQuantity(node.stats.flops, FLOP_SCALES);
  const bytes = scaledQuantity(node.stats.bytes, BYTE_SCALES);
  const throughput = scaledQuantity(node.stats.tflops, [
    { divisor: 1000, unit: 'PFLOP/s' },
    { divisor: 1, unit: 'TFLOP/s' },
  ]);
  const bandwidth = scaledQuantity(node.stats.gbps, [
    { divisor: 1000, unit: 'TB/s' },
    { divisor: 1, unit: 'GB/s' },
  ]);

  return (
    <SurfaceCard
      data-testid="kernel-inspector"
      sx={{
        height,
        minHeight: 0,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        sx={{ flexShrink: 0, gap: 1, p: '10px 12px' }}
      >
        <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 18 }}>
          {slot.name.split('.').pop()}
        </Typography>
        <Box
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.75,
            fontFamily: tokens.body,
            fontSize: 12,
            px: 1.1,
            py: 0.4,
            borderRadius: 0.75,
            color,
            border: `1px solid ${color}55`,
            background: tokens.leafbg,
          }}
        >
          <Box sx={{ width: 8, height: 8, borderRadius: '2px', background: color }} />
          {kindLabel(slot.kind)}
        </Box>
        <IconButton
          aria-label={closeLabel}
          size="small"
          onClick={onClose}
          sx={{ ml: 'auto', color: tokens.sub }}
        >
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Stack>
      <Box
        data-testid="kernel-detail-cards"
        sx={{
          display: 'grid',
          flex: 1,
          minHeight: 0,
          gridTemplateColumns: 'minmax(0,1fr)',
          alignItems: 'stretch',
          gap: 0.75,
          p: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          borderTop: `1px solid ${tokens.hair}`,
        }}
      >
        <DetailGroup title="Overview">
          <Item label="cost / call" value={fmtMs(node.ms)} teal />
          <Item label="share of tree root" value={fmtPct(node.pct)} />
          <Item label="slot" value={slot.name} />
          <Item label="kind" value={slot.kind} />
          <Item label="backend" value={slot.backend ?? 'not recorded'} />
        </DetailGroup>
        <DetailGroup title="Execution">
          <Item
            label="config"
            value={
              decodedConfig.length === 0 ? 'not recorded' : <FieldList fields={decodedConfig} />
            }
          />
          <Item
            label="exact input"
            value={decodedInput.length === 0 ? 'not recorded' : <FieldList fields={decodedInput} />}
          />
        </DetailGroup>
        <DetailGroup title="Performance">
          <Item
            label="exact FLOPs"
            value={flops.display}
            valueTitle={flops.exact === undefined ? undefined : `${flops.exact} FLOPs`}
          />
          <Item
            label="exact bytes"
            value={bytes.display}
            valueTitle={bytes.exact === undefined ? undefined : `${bytes.exact} bytes`}
          />
          <Item label="exact throughput" value={throughput.display} />
          <Item label="exact bandwidth" value={bandwidth.display} />
        </DetailGroup>
      </Box>
    </SurfaceCard>
  );
}
