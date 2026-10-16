const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateBillSummary,
  getBillStatus,
  getBillingMonthRange,
  getBillingMonthKeyFromDate,
} = require('../src/controllers/billController');
const {
  normalizeDeliveryShift,
  parseDeliveryDate,
  getPaymentInput,
} = require('../src/controllers/deliveryController');

const formatInKolkata = (date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

test('Scenario A/B/C/D: calculate bill history across payment and later delivery changes', () => {
  const firstSummary = calculateBillSummary([
    { quantityLiters: 2, amount: 120, isNoDelivery: false },
    { quantityLiters: 0, amount: 0, isNoDelivery: true },
  ], 50);

  assert.equal(firstSummary.totalMilkLiters, 2);
  assert.equal(firstSummary.totalAmount, 120);
  assert.equal(firstSummary.paidAmount, 50);
  assert.equal(firstSummary.outstandingAmount, 70);
  assert.equal(firstSummary.status, 'partially_paid');

  const fullSummary = calculateBillSummary([
    { quantityLiters: 2, amount: 120, isNoDelivery: false },
  ], 120);

  assert.equal(fullSummary.outstandingAmount, 0);
  assert.equal(fullSummary.status, 'paid');

  const updatedSummary = calculateBillSummary([
    { quantityLiters: 2, amount: 120, isNoDelivery: false },
    { quantityLiters: 1, amount: 60, isNoDelivery: false },
  ], 120);

  assert.equal(updatedSummary.totalAmount, 180);
  assert.equal(updatedSummary.outstandingAmount, 60);
  assert.equal(updatedSummary.status, 'partially_paid');
});

test('Scenario F: no-delivery entries contribute zero litres and zero amount', () => {
  const summary = calculateBillSummary([
    { quantityLiters: 0, amount: 0, isNoDelivery: true },
    { quantityLiters: 0, amount: 0, isNoDelivery: true },
  ], 0);

  assert.equal(summary.totalMilkLiters, 0);
  assert.equal(summary.totalAmount, 0);
  assert.equal(summary.outstandingAmount, 0);
  assert.equal(summary.status, 'paid');
});

test('Scenario G: preserve historical payments when the revised bill total is lower than paid', () => {
  const summary = calculateBillSummary([
    { quantityLiters: 2, amount: 120, isNoDelivery: false },
    { quantityLiters: 1, amount: 60, isNoDelivery: false },
  ], 180);

  assert.equal(summary.totalAmount, 180);
  assert.equal(summary.paidAmount, 180);
  assert.equal(summary.outstandingAmount, 0);
  assert.equal(summary.status, 'paid');
});

test('getBillStatus treats zero-value bills as paid', () => {
  assert.equal(getBillStatus(0, 0), 'paid');
  assert.equal(getBillStatus(0, 120), 'unpaid');
  assert.equal(getBillStatus(50, 120), 'partially_paid');
});

test('previous outstanding is carried once and historical excess is exposed as credit', () => {
  const carriedSummary = calculateBillSummary([
    { quantityLiters: 1, amount: 60, isNoDelivery: false },
  ], 20, 40);

  assert.equal(carriedSummary.currentPeriodAmount, 60);
  assert.equal(carriedSummary.previousOutstandingAmount, 40);
  assert.equal(carriedSummary.totalAmount, 100);
  assert.equal(carriedSummary.outstandingAmount, 80);

  const creditSummary = calculateBillSummary([], 70, 40);
  assert.equal(creditSummary.totalAmount, 40);
  assert.equal(creditSummary.paidAmount, 70);
  assert.equal(creditSummary.outstandingAmount, 0);
  assert.equal(creditSummary.creditAmount, 30);
  assert.equal(creditSummary.status, 'paid');
});

test('getBillingMonthRange uses Asia/Kolkata month boundaries', () => {
  const { fromDate, toDate } = getBillingMonthRange('2026-10');

  assert.equal(formatInKolkata(fromDate), '2026-10-01');
  assert.equal(formatInKolkata(toDate), '2026-11-01');
});

test('billing month keys follow Asia/Kolkata midnight boundaries', () => {
  assert.equal(getBillingMonthKeyFromDate('2026-09-30T18:29:59.999Z'), '2026-09');
  assert.equal(getBillingMonthKeyFromDate('2026-09-30T18:30:00.000Z'), '2026-10');
});

test('Both-shift customers accept separate Morning and Evening delivery shifts', () => {
  assert.equal(normalizeDeliveryShift('Morning', 'Both'), 'Morning');
  assert.equal(normalizeDeliveryShift('Evening', 'Both'), 'Evening');
  assert.equal(normalizeDeliveryShift('Both', 'Both'), null);
  assert.equal(normalizeDeliveryShift('Evening', 'Morning'), null);
});

test('delivery dates use valid Indian calendar days and payment choice is explicit', () => {
  assert.ok(parseDeliveryDate('2026-10-01'));
  assert.equal(parseDeliveryDate('2026-02-30'), null);
  assert.throws(() => getPaymentInput({}), /paymentChoice is required/);
  assert.equal(getPaymentInput({ paymentChoice: 'unpaid' }).choice, 'unpaid');
  assert.throws(() => getPaymentInput({ paymentChoice: 'paid', paymentAmount: 20 }), /paymentMethod/);
  assert.equal(getPaymentInput({
    paymentChoice: 'paid',
    paymentAmount: 20,
    paymentMethod: 'upi',
    idempotencyKey: 'delivery-payment-1',
  }).amount, 20);
});
