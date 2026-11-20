import { request } from './request';

const base = '/api/users/workspace-join';
export const MEMBERSHIP_EVENT = 'mamage:membership-changed';
export const membershipChanged = () => window.dispatchEvent(new Event(MEMBERSHIP_EVENT));
export const getMyMembershipRequests = signal => request(base + '/me', { signal });
export const getMembershipSummary = signal => request(base + '/summary', { signal });
export const getMembershipInbox = (options, signal) => request(base + '/inbox', { data: options, signal });
const post = async (path, data = {}) => {
  const result = await request(base + path, { method: 'POST', data });
  membershipChanged();
  return result;
};
export const skipOrganizationChoice = () => post('/skip');
export const applyToOrganization = data => post('/requests', data);
export const withdrawOrganizationRequest = id => post(`/requests/${id}/withdraw`);
export const reviewOrganizationRequest = (id, data) => post(`/requests/${id}/review`, data);
export const readMembershipNotifications = notifications => post('/read', { notifications });
