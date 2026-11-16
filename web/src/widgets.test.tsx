import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WidgetBoundary, WidgetCard, type WidgetDef } from './widgets';
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
const ok: WidgetDef = { id: 't-ok', title: 'Good tile', permission: 'any', load: async () => ({ n: 1 }), render: d => <p>count {d.n}</p> };
const throws: WidgetDef = { id: 't-bad', title: 'Bad tile', permission: 'any', load: async () => ({}), render: () => { throw new Error('boom'); } };
const fails: WidgetDef = { id: 't-fail', title: 'Failing load', permission: 'any', load: async () => { throw new Error('x'); }, render: () => null };
const empty: WidgetDef = { id: 't-empty', title: 'Empty tile', permission: 'any', load: async () => [], isEmpty: d => !d.length, render: () => null };
beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
test('an exception inside one widget does not break the others', async () => {
  wrap(<><WidgetBoundary title="Bad tile"><WidgetCard def={throws} /></WidgetBoundary><WidgetBoundary title="Good tile"><WidgetCard def={ok} /></WidgetBoundary></>);
  expect(await screen.findByText('count 1')).toBeInTheDocument(); expect(await screen.findByText(/Bad tile” failed to render/)).toBeInTheDocument();
});
test('loading failure shows an error with retry; empty data shows the empty state', async () => {
  wrap(<><WidgetCard def={fails} /><WidgetCard def={empty} /></>);
  expect(await screen.findByText(/Could not load this widget/)).toBeInTheDocument(); expect(await screen.findByText('Nothing here yet.')).toBeInTheDocument();
});
