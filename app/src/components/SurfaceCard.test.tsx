import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { tokens } from '../theme';
import SurfaceCard, { SurfaceAccentProvider } from './SurfaceCard';

describe('SurfaceCard', () => {
  it('uses a semantic left spine without replacing the shared elevation', () => {
    render(<SurfaceCard data-testid="surface" accent="#6548dc" />);

    const surfaceStyle = getComputedStyle(screen.getByTestId('surface'));
    const edge = document.querySelector<HTMLElement>('[data-surface-accent-edge]');
    const compactShadow = surfaceStyle.boxShadow.replace(/ /g, '');
    expect(edge).not.toBeNull();
    expect(surfaceStyle.borderTopWidth).toBe('1px');
    expect(surfaceStyle.borderLeftWidth).toBe('1px');
    expect(compactShadow).toContain(tokens.shadow.replace(/ /g, ''));
    expect(compactShadow).not.toContain('inset');
    expect(edge).toHaveStyle({
      position: 'absolute',
      inset: '0',
      borderRadius: 'inherit',
      borderLeft: '2px solid #6548dc',
    });
  });

  it('uses the section edge color instead of a feature-local accent', () => {
    render(
      <SurfaceAccentProvider accent="#1f6f6b">
        <SurfaceCard accent="#6548dc" />
      </SurfaceAccentProvider>,
    );

    expect(document.querySelector('[data-surface-accent-edge]')).toHaveStyle({
      borderLeft: '2px solid #1f6f6b',
    });
  });
});
