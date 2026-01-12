import streamDeck from '@elgato/streamdeck';
import { TimeTracker } from './actions/time-tracker';
import { InvoiceCreator } from './actions/invoice-creator';
import { InvoiceSummary } from './actions/invoice-summary';

streamDeck.logger.setLevel('debug');
// streamDeck.logger.setLevel('info');

const timeTrackerAction = new TimeTracker();
const invoiceCreatorAction = new InvoiceCreator();
const invoiceSummaryAction = new InvoiceSummary();

streamDeck.actions.registerAction(timeTrackerAction);
streamDeck.actions.registerAction(invoiceCreatorAction);
streamDeck.actions.registerAction(invoiceSummaryAction);

streamDeck.connect();
