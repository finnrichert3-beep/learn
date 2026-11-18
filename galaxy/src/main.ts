import '@fontsource-variable/inter/wght.css';
import './style.css';
import { boot } from './boot';

const root = document.getElementById('app');
if (root) void boot(root);
