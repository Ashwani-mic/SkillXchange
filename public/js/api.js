// API client: encapsulates all HTTP fetch requests to backend endpoints with typed, reusable helper functions.
export async function api(method, endpoint, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include'
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(endpoint, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// Auth endpoints
export const apiGetMe = () => api('GET', '/api/auth/me');
export const apiLogin = (username, password) => api('POST', '/api/auth/login', { username, password });
export const apiRegister = (userData) => api('POST', '/api/auth/register', userData);
export const apiLogout = () => api('POST', '/api/auth/logout');

// Users endpoints
export const apiGetMyProfile = () => api('GET', '/api/users/me');
export const apiUpdateMyProfile = (profileData) => api('PUT', '/api/users/me', profileData);
export const apiExploreUsers = (search = '', filter_type = '') => {
  const params = new URLSearchParams();
  if (search) params.append('search', search);
  if (filter_type) params.append('filter_type', filter_type);
  const qs = params.toString() ? `?${params.toString()}` : '';
  return api('GET', `/api/users/explore${qs}`);
};
export const apiGetUser = (userId) => api('GET', `/api/users/${userId}`);

// Skills endpoints
export const apiGetMySkills = () => api('GET', '/api/skills/me');
export const apiAddSkill = (skillData) => api('POST', '/api/skills', skillData);
export const apiDeleteSkill = (skillId) => api('DELETE', `/api/skills/${skillId}`);

// Matches endpoints
export const apiGetMatches = () => api('GET', '/api/matches');

// Messages endpoints
export const apiGetMessages = (partnerId) => api('GET', `/api/messages/${partnerId}`);
export const apiSendMessage = (receiver_id, message, reply_to_id = null) => 
  api('POST', '/api/messages', { receiver_id, message, reply_to_id });

// Sessions endpoints
export const apiGetMySessions = () => api('GET', '/api/sessions/me');
export const apiBookSession = (sessionData) => api('POST', '/api/sessions', sessionData);
export const apiUpdateSessionStatus = (sessionId, status) => 
  api('PUT', `/api/sessions/${sessionId}/status`, { status });

// Reviews endpoints
export const apiGetMyReviews = () => api('GET', '/api/reviews/me');
export const apiSubmitReview = (reviewData) => api('POST', '/api/reviews', reviewData);

// AI endpoints
export const apiGetAIConfig = () => api('GET', '/api/ai/config');
export const apiAIChat = (message, context) => api('POST', '/api/ai/chat', { message, context });
export const apiAIExtractTags = (bio) => api('POST', '/api/ai/extract-tags', { bio });

// Groups endpoints
export const apiGetGroups = () => api('GET', '/api/groups');
export const apiCreateGroup = (groupData) => api('POST', '/api/groups', groupData);
export const apiGetGroup = (groupId) => api('GET', `/api/groups/${groupId}`);
export const apiGetGroupMessages = (groupId) => api('GET', `/api/groups/${groupId}/messages`);
export const apiPostGroupMessage = (groupId, messageData) => api('POST', `/api/groups/${groupId}/messages`, messageData);
export const apiGetGroupMembers = (groupId) => api('GET', `/api/groups/${groupId}/members`);
export const apiAddGroupMembers = (groupId, memberIds) => api('POST', `/api/groups/${groupId}/members`, { memberIds });
export const apiDeleteGroup = (groupId) => api('DELETE', `/api/groups/${groupId}`);
export const apiRemoveGroupMember = (groupId, userId) => api('DELETE', `/api/groups/${groupId}/members/${userId}`);
export const apiJoinGroup = (groupId) => api('POST', `/api/groups/${groupId}/join`);

// Calls endpoints
export const apiGetCallHistory = () => api('GET', '/api/calls/history');
