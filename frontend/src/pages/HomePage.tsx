import { useContext } from 'react';
import { AuthContext } from '../context/AuthContext';

const HomePage = () => {
  const { user, logout } = useContext(AuthContext);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-sm text-gray-500">MRJ Capital</p>
          <h1 className="text-2xl font-bold">Welcome, {user?.username}</h1>
        </div>
        <button
          onClick={logout}
          className="rounded-md bg-gray-200 px-4 py-2 text-sm hover:bg-gray-300"
        >
          Sign out
        </button>
      </div>
      <p className="text-gray-600">
        Django + React + Celery scaffold. Add deal workflow features here.
      </p>
    </div>
  );
};

export default HomePage;
