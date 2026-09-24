import axios from 'axios';
import { message } from 'antd';

export const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || '/api' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('talentflow_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// 统一错误提示：名额竞争失败、状态机拒绝等业务原因直接透传后端 message
api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error?.response?.data?.message) {
      const msg = Array.isArray(error.response.data.message)
        ? error.response.data.message.join('；')
        : error.response.data.message;
      message.error(msg);
    } else if (error?.request && !error?.response) {
      message.error('网络异常，请稍后重试');
    }
    return Promise.reject(error);
  },
);
