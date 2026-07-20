/* global require */

import { Settings } from 'react-native';

const platformGet = Settings.get.bind(Settings);
Settings.get = key => {
  if (key === 'CrewEvidencePrivateUnavailableProof') return 'enabled';
  if (key === 'CrewEvidenceState') return 'private-unavailable-known';
  return platformGet(key);
};

require('../private-unavailable-option-2-entry');
