import fs from 'fs/promises';

const baseUrl = 'http://127.0.0.1:3000/api/v1';
const ADMIN_EMAIL = 'admin@methna.app';
const ADMIN_PASSWORD = 'Admin@123456';
const TEST_PASSWORD = 'Qa@123456!';

const report = {
  startedAt: new Date().toISOString(),
  baseUrl,
  setup: {},
  checks: [],
  groups: [],
  artifacts: {},
};

function unwrap(resp) {
  if (!resp?.json) return null;
  return Object.prototype.hasOwnProperty.call(resp.json, 'data') ? resp.json.data : resp.json;
}

async function api(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return {
    ok: res.ok,
    status: res.status,
    json,
    text,
  };
}

function addCheck(group, name, passed, details = {}) {
  report.checks.push({ group, name, passed: !!passed, details });
}

function summarizeGroup(group) {
  const all = report.checks.filter((c) => c.group === group);
  const passed = all.filter((c) => c.passed).length;
  report.groups.push({ group, total: all.length, passed, failed: all.length - passed });
}

async function login(email, password) {
  const resp = await api('POST', '/auth/login', { body: { email, password } });
  if (!resp.ok) {
    return { ok: false, resp };
  }
  const data = unwrap(resp);
  return {
    ok: true,
    token: data?.accessToken,
    refreshToken: data?.refreshToken,
    user: data?.user,
  };
}

async function createTestUser(adminToken, label) {
  const stamp = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const email = `runtime.${label}.${stamp}@methna.test`;
  const username = `rt_${label}_${Math.floor(Math.random() * 100000)}`;

  const createResp = await api('POST', '/admin/users', {
    token: adminToken,
    body: {
      email,
      password: TEST_PASSWORD,
      firstName: `Runtime${label}`,
      lastName: 'Tester',
      username,
      status: 'active',
    },
  });

  if (!createResp.ok) {
    throw new Error(`Create user ${label} failed: ${createResp.status} ${createResp.text}`);
  }

  const loginResp = await login(email, TEST_PASSWORD);
  if (!loginResp.ok) {
    throw new Error(`Login user ${label} failed: ${loginResp.resp.status} ${loginResp.resp.text}`);
  }

  return {
    id: loginResp.user?.id,
    email,
    token: loginResp.token,
  };
}

async function createRichProfile(token, gender) {
  return api('POST', '/profiles', {
    token,
    body: {
      bio: 'Runtime profile for end to end validation with sufficient completeness.',
      gender,
      dateOfBirth: gender === 'male' ? '1993-04-10' : '1995-08-21',
      maritalStatus: 'never_married',
      religiousLevel: 'practicing',
      sect: 'other',
      prayerFrequency: 'actively_practicing',
      dietary: 'non_strict',
      alcohol: 'drinks',
      jobTitle: 'QA Engineer',
      education: 'doctorate',
      marriageIntention: 'within_months',
      intentMode: 'serious_marriage',
      interests: ['Coffee', 'Reading', 'Traveling', 'Technology', 'Swimming'],
      languages: ['Arabic', 'English'],
      aboutPartner: 'Looking for a compatible partner for serious marriage.',
      city: 'Algiers',
      country: 'Algeria',
    },
  });
}

function normalizedType(notification) {
  const data = notification?.data || {};
  const payload = data?.payload || {};
  return (data.type || payload.type || notification?.type || '').toString().toLowerCase();
}

function findType(notifications, type) {
  return notifications.find((n) => normalizedType(n) === type);
}

async function run() {
  try {
    const adminLogin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    if (!adminLogin.ok) {
      throw new Error(`Admin login failed: ${adminLogin.resp.status} ${adminLogin.resp.text}`);
    }
    const adminToken = adminLogin.token;

    const userA = await createTestUser(adminToken, 'a');
    const userB = await createTestUser(adminToken, 'b');
    const userC = await createTestUser(adminToken, 'c');
    const userD = await createTestUser(adminToken, 'd');

    report.setup = {
      adminId: adminLogin.user?.id,
      userA,
      userB,
      userC,
      userD,
    };

    const profileA = await createRichProfile(userA.token, 'male');
    const profileB = await createRichProfile(userB.token, 'female');
    const profileC = await createRichProfile(userC.token, 'male');
    const profileD = await createRichProfile(userD.token, 'female');

    addCheck('setup', 'User A rich profile created', profileA.ok, { status: profileA.status, response: profileA.json ?? profileA.text });
    addCheck('setup', 'User B rich profile created', profileB.ok, { status: profileB.status, response: profileB.json ?? profileB.text });
    addCheck('setup', 'User C rich profile created', profileC.ok, { status: profileC.status, response: profileC.json ?? profileC.text });
    addCheck('setup', 'User D rich profile created', profileD.ok, { status: profileD.status, response: profileD.json ?? profileD.text });

    const meA = await api('GET', '/profiles/me', { token: userA.token });
    const completionA = unwrap(meA)?.profileCompletionPercentage;
    addCheck('setup', 'User A profile completion >= 60', meA.ok && Number(completionA) >= 60, {
      status: meA.status,
      profileCompletionPercentage: completionA,
    });

    summarizeGroup('setup');

    // 1) Moderation sync behavior
    const limitedUpdate = await api('PATCH', `/admin/users/${userA.id}/status`, {
      token: adminToken,
      body: {
        status: 'limited',
        reason: 'Limited for runtime QA',
        moderationReasonCode: 'OTHER',
        moderationReasonText: 'Limited for runtime QA',
        actionRequired: 'CONTACT_SUPPORT',
        supportMessage: 'Please contact support for review.',
        isUserVisible: false,
        internalAdminNote: 'Runtime moderation limited state',
      },
    });
    addCheck('moderation_sync', 'Admin sets LIMITED status', limitedUpdate.ok, {
      status: limitedUpdate.status,
      response: limitedUpdate.json ?? limitedUpdate.text,
    });

    const limitedStatusView = await api('GET', '/users/me/status', { token: userA.token });
    const limitedStatusData = unwrap(limitedStatusView);
    addCheck('moderation_sync', 'Limited user can fetch own moderation status', limitedStatusView.ok && limitedStatusData?.status === 'limited', {
      status: limitedStatusView.status,
      data: limitedStatusData,
    });

    const limitedGate = await api('GET', '/matches/suggestions?limit=5', { token: userA.token });
    addCheck('moderation_sync', 'Limited user blocked from limited routes', limitedGate.status === 403, {
      status: limitedGate.status,
      response: limitedGate.json ?? limitedGate.text,
    });

    for (const status of ['suspended', 'pending_verification', 'rejected', 'banned']) {
      const updateResp = await api('PATCH', `/admin/users/${userA.id}/status`, {
        token: adminToken,
        body: {
          status,
          reason: `Runtime ${status} state`,
          moderationReasonCode: status === 'rejected' ? 'IDENTITY_VERIFICATION_FAILED' : 'POLICY_VIOLATION',
          moderationReasonText: `Runtime ${status} state`,
          actionRequired: status === 'pending_verification' ? 'WAIT_FOR_REVIEW' : 'CONTACT_SUPPORT',
          supportMessage: `Runtime ${status} support message`,
          isUserVisible: status !== 'banned',
          internalAdminNote: `Runtime moderation ${status} state`,
        },
      });

      addCheck('moderation_sync', `Admin sets ${status.toUpperCase()} status`, updateResp.ok, {
        status: updateResp.status,
        response: updateResp.json ?? updateResp.text,
      });

      const routeResp = await api('GET', '/users/me', { token: userA.token });
      addCheck('moderation_sync', `${status.toUpperCase()} invalidates prior session`, routeResp.status === 401, {
        status: routeResp.status,
        response: routeResp.json ?? routeResp.text,
      });

      const relogin = await login(userA.email, TEST_PASSWORD);
      addCheck('moderation_sync', `${status.toUpperCase()} blocks login`, !relogin.ok && relogin.resp?.status === 401, {
        status: relogin.ok ? 200 : relogin.resp.status,
        response: relogin.ok ? null : relogin.resp.json ?? relogin.resp.text,
      });
    }

    const restoreActive = await api('PATCH', `/admin/users/${userA.id}/status`, {
      token: adminToken,
      body: {
        status: 'active',
        reason: 'Restore active after moderation validation',
        internalAdminNote: 'Runtime moderation restore active',
      },
    });
    addCheck('moderation_sync', 'Admin restores ACTIVE status', restoreActive.ok, {
      status: restoreActive.status,
      response: restoreActive.json ?? restoreActive.text,
    });

    const reloginActive = await login(userA.email, TEST_PASSWORD);
    addCheck('moderation_sync', 'Active user can login again', reloginActive.ok, {
      status: reloginActive.ok ? 200 : reloginActive.resp.status,
      response: reloginActive.ok ? null : reloginActive.resp.json ?? reloginActive.resp.text,
    });

    if (!reloginActive.ok) {
      throw new Error('Cannot continue scenarios because userA failed to login after restoring active status.');
    }
    userA.token = reloginActive.token;

    const activeGate = await api('GET', '/matches/suggestions?limit=5', { token: userA.token });
    addCheck('moderation_sync', 'Active user regains access to suggestions', activeGate.ok, {
      status: activeGate.status,
      response: activeGate.json ?? activeGate.text,
    });

    summarizeGroup('moderation_sync');

    // 2) Support sync
    const ticketCreate = await api('POST', '/support', {
      token: userA.token,
      body: {
        subject: `Runtime support ticket ${Date.now()}`,
        message: 'Validating support sync between mobile and admin.',
      },
    });
    const ticket = unwrap(ticketCreate);
    const ticketId = ticket?.id;
    addCheck('support_sync', 'User creates support ticket', ticketCreate.ok && !!ticketId, {
      status: ticketCreate.status,
      ticketId,
      response: ticketCreate.json ?? ticketCreate.text,
    });

    const adminTickets = await api('GET', `/admin/tickets?search=${encodeURIComponent(ticketId || '')}&page=1&limit=20`, {
      token: adminToken,
    });
    const adminTicketsData = unwrap(adminTickets);
    const foundInAdmin = !!adminTicketsData?.tickets?.some((t) => t.id === ticketId);
    addCheck('support_sync', 'Admin sees created ticket in dashboard list', adminTickets.ok && foundInAdmin, {
      status: adminTickets.status,
      total: adminTicketsData?.total,
    });

    const adminReply = await api('PATCH', `/admin/tickets/${ticketId}/reply`, {
      token: adminToken,
      body: {
        reply: 'Runtime QA admin reply',
        status: 'in_progress',
      },
    });
    addCheck('support_sync', 'Admin replies to ticket', adminReply.ok, {
      status: adminReply.status,
      response: adminReply.json ?? adminReply.text,
    });

    const ticketDetail = await api('GET', `/support/my-tickets/${ticketId}`, { token: userA.token });
    const ticketDetailData = unwrap(ticketDetail);
    addCheck(
      'support_sync',
      'User sees ticket reply and status sync',
      ticketDetail.ok && ticketDetailData?.status === 'in_progress' && !!ticketDetailData?.adminReply,
      {
        status: ticketDetail.status,
        data: ticketDetailData,
      },
    );

    summarizeGroup('support_sync');

    // 3) Notifications routing types
    await api('DELETE', '/notifications/clear-all', { token: userA.token });
    await api('DELETE', '/notifications/clear-all', { token: userB.token });

    const like1 = await api('POST', '/swipes', {
      token: userB.token,
      body: { targetUserId: userA.id, action: 'like' },
    });
    addCheck('notifications_routing', 'Like notification trigger succeeds', like1.ok, {
      status: like1.status,
      response: like1.json ?? like1.text,
    });

    const like2 = await api('POST', '/swipes', {
      token: userA.token,
      body: { targetUserId: userB.id, action: 'like' },
    });
    addCheck('notifications_routing', 'Match notification trigger succeeds', like2.ok, {
      status: like2.status,
      response: like2.json ?? like2.text,
    });

    const conversation = await api('POST', '/chat/conversations', {
      token: userA.token,
      body: { targetUserId: userB.id },
    });
    const conversationId = unwrap(conversation)?.id;
    addCheck('notifications_routing', 'Conversation open succeeds', conversation.ok && !!conversationId, {
      status: conversation.status,
      conversationId,
      response: conversation.json ?? conversation.text,
    });

    const message = await api('POST', `/chat/conversations/${conversationId}/messages`, {
      token: userA.token,
      body: { content: 'Runtime message notification test' },
    });
    addCheck('notifications_routing', 'Message notification trigger succeeds', message.ok, {
      status: message.status,
      response: message.json ?? message.text,
    });

    const selfiePatch = await api('PATCH', `/admin/users/${userA.id}`, {
      token: adminToken,
      body: { selfieUrl: 'https://example.com/runtime-selfie.jpg' },
    });
    addCheck('notifications_routing', 'Selfie URL can be prepared for verification notification', selfiePatch.ok, {
      status: selfiePatch.status,
      response: selfiePatch.json ?? selfiePatch.text,
    });

    const verificationReject = await api('PATCH', `/admin/users/${userA.id}/verification/selfie`, {
      token: adminToken,
      body: { status: 'rejected', rejectionReason: 'Runtime verification rejection.' },
    });
    addCheck('notifications_routing', 'Verification notification trigger succeeds', verificationReject.ok, {
      status: verificationReject.status,
      response: verificationReject.json ?? verificationReject.text,
    });

    const systemSend = await api('POST', '/admin/notifications/send', {
      token: adminToken,
      body: {
        userId: userA.id,
        title: 'Runtime System Notification',
        body: 'System route validation',
        type: 'system',
      },
    });
    addCheck('notifications_routing', 'System notification send succeeds', systemSend.ok, {
      status: systemSend.status,
      response: systemSend.json ?? systemSend.text,
    });

    const notifsResp = await api('GET', '/notifications?page=1&limit=100', { token: userA.token });
    const notifications = unwrap(notifsResp)?.notifications || [];
    report.artifacts.notificationsSample = 'tmp/runtime-notifications-sample-v2.json';
    await fs.writeFile(report.artifacts.notificationsSample, JSON.stringify(notifications, null, 2), 'utf8');

    const likeNotif = findType(notifications, 'like');
    const matchNotif = findType(notifications, 'match');
    const messageNotif = findType(notifications, 'message');
    const ticketNotif = findType(notifications, 'ticket');
    const verificationNotif = findType(notifications, 'verification');
    const systemNotif = notifications.find((n) => normalizedType(n) === 'system' && n.title === 'Runtime System Notification');

    addCheck('notifications_routing', 'LIKE notification delivered', !!likeNotif, { id: likeNotif?.id, type: likeNotif ? normalizedType(likeNotif) : null });
    addCheck('notifications_routing', 'MATCH notification delivered', !!matchNotif, { id: matchNotif?.id, type: matchNotif ? normalizedType(matchNotif) : null });
    addCheck('notifications_routing', 'MESSAGE notification delivered', !!messageNotif, { id: messageNotif?.id, type: messageNotif ? normalizedType(messageNotif) : null });
    addCheck('notifications_routing', 'TICKET notification delivered', !!ticketNotif, { id: ticketNotif?.id, type: ticketNotif ? normalizedType(ticketNotif) : null });
    addCheck('notifications_routing', 'VERIFICATION notification delivered', !!verificationNotif, { id: verificationNotif?.id, type: verificationNotif ? normalizedType(verificationNotif) : null });
    addCheck('notifications_routing', 'SYSTEM notification delivered', !!systemNotif, { id: systemNotif?.id, type: systemNotif ? normalizedType(systemNotif) : null });

    summarizeGroup('notifications_routing');

    // 4) Premium and consumables
    const now = new Date();
    const in7Days = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    const grantPremium = await api('POST', `/admin/users/${userA.id}/premium`, {
      token: adminToken,
      body: {
        startDate: now.toISOString(),
        expiryDate: in7Days.toISOString(),
      },
    });
    addCheck('premium_consumables', 'Admin premium grant succeeds', grantPremium.ok, {
      status: grantPremium.status,
      response: grantPremium.json ?? grantPremium.text,
    });

    const mobileSub = await api('GET', '/mobile/subscription/me', { token: userA.token });
    const mobileSubData = unwrap(mobileSub);
    addCheck(
      'premium_consumables',
      'Mobile subscription endpoint reflects premium state',
      mobileSub.ok && (mobileSubData?.plan || 'free') !== 'free' && ['active', 'past_due', 'trialing'].includes((mobileSubData?.status || '').toLowerCase()),
      {
        status: mobileSub.status,
        plan: mobileSubData?.plan,
        subscriptionStatus: mobileSubData?.status,
      },
    );

    const monetization = await api('GET', '/monetization/status', { token: userA.token });
    const monetizationData = unwrap(monetization);
    addCheck('premium_consumables', 'Monetization status shows features/limits', monetization.ok && Array.isArray(monetizationData?.features), {
      status: monetization.status,
      plan: monetizationData?.plan,
      featuresCount: Array.isArray(monetizationData?.features) ? monetizationData.features.length : null,
    });

    const consumables = await api('GET', '/mobile/consumables', { token: userA.token });
    const consumablesData = unwrap(consumables) || [];
    addCheck('premium_consumables', 'Consumables catalog available with products', consumables.ok && Array.isArray(consumablesData) && consumablesData.length > 0, {
      status: consumables.status,
      count: Array.isArray(consumablesData) ? consumablesData.length : null,
      products: Array.isArray(consumablesData) ? consumablesData.map((p) => ({ code: p.code, type: p.type, googleProductId: p.googleProductId })) : null,
    });

    const product = Array.isArray(consumablesData) ? consumablesData.find((p) => !!p.googleProductId) : null;
    const verifyConsumable = product
      ? await api('POST', '/mobile/consumables/google-play/verify', {
          token: userA.token,
          body: {
            productId: product.googleProductId,
            purchaseToken: `runtime-token-${Date.now()}`,
            orderId: `runtime-order-${Date.now()}`,
            transactionDate: new Date().toISOString(),
          },
        })
      : null;

    addCheck('premium_consumables', 'Consumable purchase verify flow executes', !!(verifyConsumable && verifyConsumable.ok), {
      skipped: !product,
      status: verifyConsumable?.status,
      response: verifyConsumable?.json ?? verifyConsumable?.text ?? null,
      note: !product ? 'No consumable with googleProductId was available.' : 'If failed, Google verification may be required in runtime environment.',
    });

    summarizeGroup('premium_consumables');

    // 5) Matching and filtering
    const matchesResp = await api('GET', '/matches?page=1&limit=20', { token: userA.token });
    const matchesData = unwrap(matchesResp);
    const hasMatch = !!matchesData?.matches?.some((m) => {
      const ids = [m.user1Id, m.user2Id, m.user?.id, m.matchedUser?.id].filter(Boolean);
      return ids.includes(userB.id);
    });
    addCheck('matching_filters', 'Mutual match appears in matches list', matchesResp.ok && hasMatch, {
      status: matchesResp.status,
      total: matchesData?.total,
    });

    const prefUpdate = await api('PUT', '/profiles/preferences', {
      token: userA.token,
      body: {
        minAge: 21,
        maxAge: 38,
        preferredGender: 'female',
        maxDistance: 250,
      },
    });
    addCheck('matching_filters', 'Preference update succeeds', prefUpdate.ok, {
      status: prefUpdate.status,
      response: prefUpdate.json ?? prefUpdate.text,
    });

    const prefRead = await api('GET', '/profiles/preferences', { token: userA.token });
    const prefData = unwrap(prefRead);
    addCheck('matching_filters', 'Preference update persisted', prefRead.ok && prefData?.preferredGender === 'female' && Number(prefData?.minAge) === 21, {
      status: prefRead.status,
      data: prefData,
    });

    const search = await api('GET', '/search?gender=female&goGlobal=true&limit=50&sortBy=newest', { token: userA.token });
    const searchUsers = unwrap(search)?.users || [];
    const containsMale = searchUsers.some((u) => (u?.profile?.gender || '').toLowerCase() === 'male');
    addCheck('matching_filters', 'Search filter by gender excludes male profiles', search.ok && !containsMale, {
      status: search.status,
      resultCount: Array.isArray(searchUsers) ? searchUsers.length : null,
      containsMale,
    });

    summarizeGroup('matching_filters');

    // 6) Profile/settings sync + restart
    const accountUpdate = await api('PATCH', '/users/me', {
      token: userA.token,
      body: {
        firstName: 'RuntimeUpdated',
        lastName: 'Profile',
      },
    });
    addCheck('profile_settings_sync', 'User account update succeeds', accountUpdate.ok, {
      status: accountUpdate.status,
      response: accountUpdate.json ?? accountUpdate.text,
    });

    const notifUpdate = await api('PATCH', '/notifications/settings', {
      token: userA.token,
      body: {
        promotionsNotifications: false,
        weeklySummaryNotifications: false,
      },
    });
    addCheck('profile_settings_sync', 'Notification settings update succeeds', notifUpdate.ok, {
      status: notifUpdate.status,
      response: notifUpdate.json ?? notifUpdate.text,
    });

    const chatUpdate = await api('PATCH', '/chat/settings', {
      token: userA.token,
      body: {
        readReceipts: false,
        typingIndicator: false,
      },
    });
    addCheck('profile_settings_sync', 'Chat settings update succeeds', chatUpdate.ok, {
      status: chatUpdate.status,
      response: chatUpdate.json ?? chatUpdate.text,
    });

    const adminDetail = await api('GET', `/admin/users/${userA.id}`, { token: adminToken });
    const adminDetailData = unwrap(adminDetail);
    addCheck('profile_settings_sync', 'Admin sees updated account names', adminDetail.ok && adminDetailData?.firstName === 'RuntimeUpdated' && adminDetailData?.lastName === 'Profile', {
      status: adminDetail.status,
      firstName: adminDetailData?.firstName,
      lastName: adminDetailData?.lastName,
    });

    const relogin = await login(userA.email, TEST_PASSWORD);
    addCheck('profile_settings_sync', 'User can re-login after updates', relogin.ok, {
      status: relogin.ok ? 200 : relogin.resp.status,
    });

    if (relogin.ok) {
      userA.token = relogin.token;
    }

    const prefAfterRestart = await api('GET', '/profiles/preferences', { token: userA.token });
    const prefAfterData = unwrap(prefAfterRestart);
    addCheck('profile_settings_sync', 'Preferences persist after restart/login', prefAfterRestart.ok && prefAfterData?.preferredGender === 'female' && Number(prefAfterData?.minAge) === 21, {
      status: prefAfterRestart.status,
      data: prefAfterData,
    });

    const notifAfterRestart = await api('GET', '/notifications/settings', { token: userA.token });
    const notifAfterData = unwrap(notifAfterRestart);
    addCheck('profile_settings_sync', 'Notification settings persist after restart/login', notifAfterRestart.ok && notifAfterData?.promotionsNotifications === false, {
      status: notifAfterRestart.status,
      data: notifAfterData,
    });

    summarizeGroup('profile_settings_sync');

    // 7) Verification sync
    const verifyBefore = await api('GET', '/trust-safety/verification-status', { token: userA.token });
    addCheck('verification_sync', 'Verification status endpoint available', verifyBefore.ok, {
      status: verifyBefore.status,
      data: unwrap(verifyBefore),
    });

    const verifyPending = await api('PATCH', `/admin/users/${userA.id}/verification/selfie`, {
      token: adminToken,
      body: { status: 'pending' },
    });
    const verifyPendingView = await api('GET', '/trust-safety/verification-status', { token: userA.token });
    const verifyPendingData = unwrap(verifyPendingView);
    addCheck('verification_sync', 'Pending verification syncs to mobile endpoint', verifyPending.ok && verifyPendingView.ok && verifyPendingData?.selfieStatus === 'pending', {
      updateStatus: verifyPending.status,
      readStatus: verifyPendingView.status,
      selfieStatus: verifyPendingData?.selfieStatus,
    });

    const verifyRejected = await api('PATCH', `/admin/users/${userA.id}/verification/selfie`, {
      token: adminToken,
      body: { status: 'rejected', rejectionReason: 'Runtime selfie rejected reason' },
    });
    const verifyRejectedView = await api('GET', '/trust-safety/verification-status', { token: userA.token });
    const verifyRejectedData = unwrap(verifyRejectedView);
    addCheck('verification_sync', 'Rejected verification syncs to mobile endpoint', verifyRejected.ok && verifyRejectedView.ok && verifyRejectedData?.selfieStatus === 'rejected', {
      updateStatus: verifyRejected.status,
      readStatus: verifyRejectedView.status,
      selfieStatus: verifyRejectedData?.selfieStatus,
      selfieRejectionReason: verifyRejectedData?.selfieRejectionReason,
    });

    const verifyApproved = await api('PATCH', `/admin/users/${userA.id}/verification/selfie`, {
      token: adminToken,
      body: { status: 'approved' },
    });
    const verifyApprovedView = await api('GET', '/trust-safety/verification-status', { token: userA.token });
    const verifyApprovedData = unwrap(verifyApprovedView);
    addCheck('verification_sync', 'Approved verification syncs to mobile endpoint', verifyApproved.ok && verifyApprovedView.ok && verifyApprovedData?.selfieStatus === 'approved', {
      updateStatus: verifyApproved.status,
      readStatus: verifyApprovedView.status,
      selfieStatus: verifyApprovedData?.selfieStatus,
    });

    summarizeGroup('verification_sync');

    const total = report.checks.length;
    const passed = report.checks.filter((c) => c.passed).length;
    const failed = total - passed;
    const readinessScore = total ? Math.round((passed / total) * 100) : 0;

    report.summary = {
      totalChecks: total,
      passedChecks: passed,
      failedChecks: failed,
      readinessScore,
    };
    report.finishedAt = new Date().toISOString();

    await fs.writeFile('tmp/runtime-validation-report-v2.json', JSON.stringify(report, null, 2), 'utf8');

    console.log(
      JSON.stringify(
        {
          ok: true,
          reportPath: 'tmp/runtime-validation-report-v2.json',
          readinessScore,
          totalChecks: total,
          failedChecks: failed,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    report.fatalError = { message: error?.message || String(error), stack: error?.stack || null };
    report.finishedAt = new Date().toISOString();
    await fs.writeFile('tmp/runtime-validation-report-v2.json', JSON.stringify(report, null, 2), 'utf8');
    console.error(JSON.stringify({ ok: false, error: report.fatalError, reportPath: 'tmp/runtime-validation-report-v2.json' }, null, 2));
    process.exitCode = 1;
  }
}

run();
