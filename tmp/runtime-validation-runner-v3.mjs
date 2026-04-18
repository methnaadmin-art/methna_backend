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

    const userA = await createTestUser(adminToken, 'a'); // moderation actor only
    const userB = await createTestUser(adminToken, 'b'); // main runtime actor
    const userC = await createTestUser(adminToken, 'c'); // peer actor
    const userD = await createTestUser(adminToken, 'd'); // filter actor

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

    addCheck('setup', 'User A rich profile created', profileA.ok, { status: profileA.status });
    addCheck('setup', 'User B rich profile created', profileB.ok, { status: profileB.status });
    addCheck('setup', 'User C rich profile created', profileC.ok, { status: profileC.status });
    addCheck('setup', 'User D rich profile created', profileD.ok, { status: profileD.status });

    const meB = await api('GET', '/profiles/me', { token: userB.token });
    const completionB = unwrap(meB)?.profileCompletionPercentage;
    addCheck('setup', 'Main user profile completion >= 60', meB.ok && Number(completionB) >= 60, {
      status: meB.status,
      profileCompletionPercentage: completionB,
    });

    summarizeGroup('setup');

    // 1) Moderation sync (use userA only)
    const limited = await api('PATCH', `/admin/users/${userA.id}/status`, {
      token: adminToken,
      body: {
        status: 'limited',
        reason: 'Runtime limited state',
        moderationReasonCode: 'OTHER',
        moderationReasonText: 'Runtime limited state',
        actionRequired: 'CONTACT_SUPPORT',
        supportMessage: 'Contact support for review.',
        isUserVisible: false,
        internalAdminNote: 'Runtime limited test',
      },
    });
    addCheck('moderation_sync', 'Admin sets LIMITED status', limited.ok, { status: limited.status });

    const limitedStatus = await api('GET', '/users/me/status', { token: userA.token });
    const limitedStatusData = unwrap(limitedStatus);
    addCheck('moderation_sync', 'Limited user sees status payload', limitedStatus.ok && limitedStatusData?.status === 'limited', {
      status: limitedStatus.status,
      data: limitedStatusData,
    });

    const limitedGate = await api('GET', '/matches/suggestions?limit=5', { token: userA.token });
    addCheck('moderation_sync', 'Limited user blocked from restricted route', limitedGate.status === 403, {
      status: limitedGate.status,
      response: limitedGate.json ?? limitedGate.text,
    });

    for (const status of ['suspended', 'pending_verification', 'rejected', 'banned']) {
      const update = await api('PATCH', `/admin/users/${userA.id}/status`, {
        token: adminToken,
        body: {
          status,
          reason: `Runtime ${status} state`,
          moderationReasonCode: status === 'rejected' ? 'IDENTITY_VERIFICATION_FAILED' : 'POLICY_VIOLATION',
          moderationReasonText: `Runtime ${status} state`,
          actionRequired: status === 'pending_verification' ? 'WAIT_FOR_REVIEW' : 'CONTACT_SUPPORT',
          supportMessage: `Runtime ${status} support`,
          isUserVisible: status !== 'banned',
          internalAdminNote: `Runtime ${status} note`,
        },
      });
      addCheck('moderation_sync', `Admin sets ${status.toUpperCase()} status`, update.ok, {
        status: update.status,
      });

      const staleTokenCall = await api('GET', '/users/me', { token: userA.token });
      addCheck('moderation_sync', `${status.toUpperCase()} revokes existing session`, staleTokenCall.status === 401, {
        status: staleTokenCall.status,
        response: staleTokenCall.json ?? staleTokenCall.text,
      });

      const adminView = await api('GET', `/admin/users/${userA.id}`, { token: adminToken });
      const adminData = unwrap(adminView);
      addCheck('moderation_sync', `Admin view reflects ${status.toUpperCase()} state`, adminView.ok && adminData?.status === status, {
        status: adminView.status,
        adminStatus: adminData?.status,
      });
    }

    const restoreA = await api('PATCH', `/admin/users/${userA.id}/status`, {
      token: adminToken,
      body: {
        status: 'active',
        reason: 'Restore active after runtime moderation tests',
        internalAdminNote: 'Runtime restore active',
      },
    });
    addCheck('moderation_sync', 'Admin restores ACTIVE status', restoreA.ok, { status: restoreA.status });

    const adminAfterRestore = await api('GET', `/admin/users/${userA.id}`, { token: adminToken });
    const adminAfterRestoreData = unwrap(adminAfterRestore);
    addCheck('moderation_sync', 'Admin view shows ACTIVE after restore', adminAfterRestore.ok && adminAfterRestoreData?.status === 'active', {
      status: adminAfterRestore.status,
      adminStatus: adminAfterRestoreData?.status,
    });

    summarizeGroup('moderation_sync');

    // 2) Support sync using userB
    const ticketCreate = await api('POST', '/support', {
      token: userB.token,
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
    });

    const adminTickets = await api('GET', `/admin/tickets?search=${encodeURIComponent(ticketId || '')}&page=1&limit=20`, {
      token: adminToken,
    });
    const adminTicketsData = unwrap(adminTickets);
    const foundInAdmin = !!adminTicketsData?.tickets?.some((t) => t.id === ticketId);
    addCheck('support_sync', 'Admin sees created ticket', adminTickets.ok && foundInAdmin, {
      status: adminTickets.status,
      total: adminTicketsData?.total,
    });

    const reply = await api('PATCH', `/admin/tickets/${ticketId}/reply`, {
      token: adminToken,
      body: {
        reply: 'Runtime QA admin reply',
        status: 'in_progress',
      },
    });
    addCheck('support_sync', 'Admin replies to ticket', reply.ok, {
      status: reply.status,
      response: reply.json ?? reply.text,
    });

    const ticketDetail = await api('GET', `/support/my-tickets/${ticketId}`, { token: userB.token });
    const ticketDetailData = unwrap(ticketDetail);
    addCheck('support_sync', 'User sees reply and updated ticket status', ticketDetail.ok && ticketDetailData?.status === 'in_progress' && !!ticketDetailData?.adminReply, {
      status: ticketDetail.status,
      data: ticketDetailData,
    });

    summarizeGroup('support_sync');

    // 3) Notification types + routing inputs using userB as receiver
    await api('DELETE', '/notifications/clear-all', { token: userB.token });
    await api('DELETE', '/notifications/clear-all', { token: userC.token });

    const cLikesB = await api('POST', '/swipes', {
      token: userC.token,
      body: { targetUserId: userB.id, action: 'like' },
    });
    addCheck('notifications_routing', 'LIKE trigger action succeeds', cLikesB.ok, {
      status: cLikesB.status,
      response: cLikesB.json ?? cLikesB.text,
    });

    const bLikesC = await api('POST', '/swipes', {
      token: userB.token,
      body: { targetUserId: userC.id, action: 'like' },
    });
    addCheck('notifications_routing', 'MATCH trigger action succeeds', bLikesC.ok, {
      status: bLikesC.status,
      response: bLikesC.json ?? bLikesC.text,
    });

    const conv = await api('POST', '/chat/conversations', {
      token: userB.token,
      body: { targetUserId: userC.id },
    });
    const conversationId = unwrap(conv)?.id;
    addCheck('notifications_routing', 'Conversation open succeeds', conv.ok && !!conversationId, {
      status: conv.status,
      conversationId,
    });

    const cMessageB = await api('POST', `/chat/conversations/${conversationId}/messages`, {
      token: userC.token,
      body: { content: 'Runtime message notification test' },
    });
    addCheck('notifications_routing', 'MESSAGE trigger action succeeds', cMessageB.ok, {
      status: cMessageB.status,
      response: cMessageB.json ?? cMessageB.text,
    });

    const selfiePatch = await api('PATCH', `/admin/users/${userB.id}`, {
      token: adminToken,
      body: { selfieUrl: 'https://example.com/runtime-selfie-b.jpg' },
    });
    addCheck('notifications_routing', 'Selfie URL prepared for verification notification', selfiePatch.ok, { status: selfiePatch.status });

    const verifyReject = await api('PATCH', `/admin/users/${userB.id}/verification/selfie`, {
      token: adminToken,
      body: { status: 'rejected', rejectionReason: 'Runtime verification rejection for notification test.' },
    });
    addCheck('notifications_routing', 'VERIFICATION trigger action succeeds', verifyReject.ok, {
      status: verifyReject.status,
      response: verifyReject.json ?? verifyReject.text,
    });

    const systemSend = await api('POST', '/admin/notifications/send', {
      token: adminToken,
      body: {
        userId: userB.id,
        title: 'Runtime System Notification',
        body: 'System route validation',
        type: 'system',
      },
    });
    addCheck('notifications_routing', 'SYSTEM notification send succeeds', systemSend.ok, {
      status: systemSend.status,
      response: systemSend.json ?? systemSend.text,
    });

    const notifList = await api('GET', '/notifications?page=1&limit=100', { token: userB.token });
    const notifications = unwrap(notifList)?.notifications || [];
    report.artifacts.notificationsSample = 'tmp/runtime-notifications-sample-v3.json';
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

    // 4) Premium + consumables using userB
    const startDate = new Date();
    const expiryDate = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    const grantPremium = await api('POST', `/admin/users/${userB.id}/premium`, {
      token: adminToken,
      body: {
        startDate: startDate.toISOString(),
        expiryDate: expiryDate.toISOString(),
      },
    });
    addCheck('premium_consumables', 'Admin grants premium to user', grantPremium.ok, { status: grantPremium.status });

    const mobileSub = await api('GET', '/mobile/subscription/me', { token: userB.token });
    const mobileSubData = unwrap(mobileSub);
    addCheck('premium_consumables', 'Mobile subscription endpoint reflects premium', mobileSub.ok && (mobileSubData?.plan || 'free') !== 'free' && ['active', 'past_due', 'trialing'].includes((mobileSubData?.status || '').toLowerCase()), {
      status: mobileSub.status,
      plan: mobileSubData?.plan,
      subscriptionStatus: mobileSubData?.status,
    });

    const monetization = await api('GET', '/monetization/status', { token: userB.token });
    const monetizationData = unwrap(monetization);
    addCheck('premium_consumables', 'Monetization status has premium features', monetization.ok && Array.isArray(monetizationData?.features) && monetizationData.features.length > 0, {
      status: monetization.status,
      plan: monetizationData?.plan,
      featuresCount: Array.isArray(monetizationData?.features) ? monetizationData.features.length : null,
    });

    const consumables = await api('GET', '/mobile/consumables', { token: userB.token });
    const consumablesData = unwrap(consumables) || [];
    addCheck('premium_consumables', 'Consumables catalog available with at least one product', consumables.ok && Array.isArray(consumablesData) && consumablesData.length > 0, {
      status: consumables.status,
      count: Array.isArray(consumablesData) ? consumablesData.length : null,
      products: Array.isArray(consumablesData) ? consumablesData.map((p) => ({ code: p.code, type: p.type, googleProductId: p.googleProductId })) : null,
    });

    const product = Array.isArray(consumablesData) ? consumablesData.find((p) => !!p.googleProductId) : null;
    const verifyConsumable = product
      ? await api('POST', '/mobile/consumables/google-play/verify', {
          token: userB.token,
          body: {
            productId: product.googleProductId,
            purchaseToken: `runtime-token-${Date.now()}`,
            orderId: `runtime-order-${Date.now()}`,
            transactionDate: new Date().toISOString(),
          },
        })
      : null;

    addCheck('premium_consumables', 'Consumable purchase verification flow executes', !!(verifyConsumable && verifyConsumable.ok), {
      skipped: !product,
      status: verifyConsumable?.status,
      response: verifyConsumable?.json ?? verifyConsumable?.text ?? null,
      note: !product ? 'No googleProductId consumable available.' : 'If failed, Google verification is enforced and test tokens are rejected.',
    });

    summarizeGroup('premium_consumables');

    // 5) Matching + filter sync using userB
    const matches = await api('GET', '/matches?page=1&limit=20', { token: userB.token });
    const matchesData = unwrap(matches);
    const hasMatch = !!matchesData?.matches?.some((m) => {
      const ids = [m.user1Id, m.user2Id, m.user?.id, m.matchedUser?.id].filter(Boolean);
      return ids.includes(userC.id);
    });
    addCheck('matching_filters', 'Mutual match appears in matches list', matches.ok && hasMatch, {
      status: matches.status,
      total: matchesData?.total,
    });

    const prefUpdate = await api('PUT', '/profiles/preferences', {
      token: userB.token,
      body: {
        minAge: 21,
        maxAge: 38,
        preferredGender: 'male',
        maxDistance: 250,
      },
    });
    addCheck('matching_filters', 'Preference update succeeds', prefUpdate.ok, {
      status: prefUpdate.status,
      response: prefUpdate.json ?? prefUpdate.text,
    });

    const prefRead = await api('GET', '/profiles/preferences', { token: userB.token });
    const prefData = unwrap(prefRead);
    addCheck('matching_filters', 'Preference update persisted', prefRead.ok && prefData?.preferredGender === 'male' && Number(prefData?.minAge) === 21, {
      status: prefRead.status,
      data: prefData,
    });

    const search = await api('GET', '/search?gender=male&goGlobal=true&limit=50&sortBy=newest', { token: userB.token });
    const searchUsers = unwrap(search)?.users || [];
    const containsFemale = searchUsers.some((u) => (u?.profile?.gender || '').toLowerCase() === 'female');
    addCheck('matching_filters', 'Search filter by gender excludes opposite gender', search.ok && !containsFemale, {
      status: search.status,
      resultCount: Array.isArray(searchUsers) ? searchUsers.length : null,
      containsFemale,
    });

    summarizeGroup('matching_filters');

    // 6) Profile/settings sync using userB
    const userPatch = await api('PATCH', '/users/me', {
      token: userB.token,
      body: {
        firstName: 'RuntimeUpdated',
        lastName: 'Profile',
      },
    });
    addCheck('profile_settings_sync', 'User account update succeeds', userPatch.ok, {
      status: userPatch.status,
      response: userPatch.json ?? userPatch.text,
    });

    const notifPatch = await api('PATCH', '/notifications/settings', {
      token: userB.token,
      body: {
        promotionsNotifications: false,
        weeklySummaryNotifications: false,
      },
    });
    addCheck('profile_settings_sync', 'Notification settings update succeeds', notifPatch.ok, {
      status: notifPatch.status,
    });

    const chatPatch = await api('PATCH', '/chat/settings', {
      token: userB.token,
      body: {
        readReceipts: false,
        typingIndicator: false,
      },
    });
    addCheck('profile_settings_sync', 'Chat settings update succeeds', chatPatch.ok, {
      status: chatPatch.status,
    });

    const adminDetail = await api('GET', `/admin/users/${userB.id}`, { token: adminToken });
    const adminDetailData = unwrap(adminDetail);
    addCheck('profile_settings_sync', 'Admin sees updated user names', adminDetail.ok && adminDetailData?.firstName === 'RuntimeUpdated' && adminDetailData?.lastName === 'Profile', {
      status: adminDetail.status,
      firstName: adminDetailData?.firstName,
      lastName: adminDetailData?.lastName,
    });

    const reloginB = await login(userB.email, TEST_PASSWORD);
    addCheck('profile_settings_sync', 'User can re-login after updates', reloginB.ok, {
      status: reloginB.ok ? 200 : reloginB.resp.status,
    });

    if (reloginB.ok) {
      userB.token = reloginB.token;
    }

    const prefAfter = await api('GET', '/profiles/preferences', { token: userB.token });
    const prefAfterData = unwrap(prefAfter);
    addCheck('profile_settings_sync', 'Preferences persist after re-login', prefAfter.ok && prefAfterData?.preferredGender === 'male' && Number(prefAfterData?.minAge) === 21, {
      status: prefAfter.status,
      data: prefAfterData,
    });

    const notifAfter = await api('GET', '/notifications/settings', { token: userB.token });
    const notifAfterData = unwrap(notifAfter);
    addCheck('profile_settings_sync', 'Notification settings persist after re-login', notifAfter.ok && notifAfterData?.promotionsNotifications === false, {
      status: notifAfter.status,
      data: notifAfterData,
    });

    summarizeGroup('profile_settings_sync');

    // 7) Verification sync using userB
    const verifyStatus = await api('GET', '/trust-safety/verification-status', { token: userB.token });
    addCheck('verification_sync', 'Verification status endpoint available', verifyStatus.ok, {
      status: verifyStatus.status,
      data: unwrap(verifyStatus),
    });

    const toPending = await api('PATCH', `/admin/users/${userB.id}/verification/selfie`, {
      token: adminToken,
      body: { status: 'pending' },
    });
    const pendingView = await api('GET', '/trust-safety/verification-status', { token: userB.token });
    const pendingData = unwrap(pendingView);
    addCheck('verification_sync', 'Pending verification reflected to user endpoint', toPending.ok && pendingView.ok && pendingData?.selfieStatus === 'pending', {
      updateStatus: toPending.status,
      readStatus: pendingView.status,
      selfieStatus: pendingData?.selfieStatus,
    });

    const toRejected = await api('PATCH', `/admin/users/${userB.id}/verification/selfie`, {
      token: adminToken,
      body: { status: 'rejected', rejectionReason: 'Runtime rejection reason' },
    });
    const rejectedView = await api('GET', '/trust-safety/verification-status', { token: userB.token });
    const rejectedData = unwrap(rejectedView);
    addCheck('verification_sync', 'Rejected verification reflected to user endpoint', toRejected.ok && rejectedView.ok && rejectedData?.selfieStatus === 'rejected', {
      updateStatus: toRejected.status,
      readStatus: rejectedView.status,
      selfieStatus: rejectedData?.selfieStatus,
      rejectionReason: rejectedData?.selfieRejectionReason,
    });

    const toApproved = await api('PATCH', `/admin/users/${userB.id}/verification/selfie`, {
      token: adminToken,
      body: { status: 'approved' },
    });
    const approvedView = await api('GET', '/trust-safety/verification-status', { token: userB.token });
    const approvedData = unwrap(approvedView);
    addCheck('verification_sync', 'Approved verification reflected to user endpoint', toApproved.ok && approvedView.ok && approvedData?.selfieStatus === 'approved', {
      updateStatus: toApproved.status,
      readStatus: approvedView.status,
      selfieStatus: approvedData?.selfieStatus,
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

    await fs.writeFile('tmp/runtime-validation-report-v3.json', JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify({ ok: true, reportPath: 'tmp/runtime-validation-report-v3.json', readinessScore, totalChecks: total, failedChecks: failed }, null, 2));
  } catch (error) {
    report.fatalError = { message: error?.message || String(error), stack: error?.stack || null };
    report.finishedAt = new Date().toISOString();
    await fs.writeFile('tmp/runtime-validation-report-v3.json', JSON.stringify(report, null, 2), 'utf8');
    console.error(JSON.stringify({ ok: false, error: report.fatalError, reportPath: 'tmp/runtime-validation-report-v3.json' }, null, 2));
    process.exitCode = 1;
  }
}

run();
