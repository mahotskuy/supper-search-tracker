import React from 'react';
import { hot } from 'react-hot-loader';

import {DisableLint} from './components/strange-code/search-handler'; // subscribed to search box

function App() {
  return (
    <DisableLint/>
  );
}
 
export default hot(module)(App);