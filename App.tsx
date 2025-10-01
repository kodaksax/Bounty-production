import React, { useEffect, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { supabase } from 'lib/supabase';

interface Todo {
  id: string
  title: string
  completed?: boolean
}

export default function App() {
  const [todos, setTodos] = useState<Todo[]>([]);

  useEffect(() => {
    const getTodos = async () => {
      try {
  // use a typed query: pass table name as string then cast the returned rows to Todo[]
  const res = await supabase.from('todos').select();
  const data = res.data as Todo[] | null
  const sbError = res.error
        if (sbError) {
          console.error('Error fetching todos:', sbError.message);
          return;
        }

        if (data && data.length > 0) {
          setTodos(data);
        }
      } catch (err: unknown) {
        // Narrow the unknown error before reading .message
        if (err instanceof Error) {
          console.error('Error fetching todos:', err.message);
        } else {
          console.error('Error fetching todos:', String(err));
        }
      }
    };

    getTodos();
  }, []);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Text>Todo List</Text>
      <FlatList
        data={todos}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => <Text key={item.id}>{item.title}</Text>}
      />
    </View>
  );
};

