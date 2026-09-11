<?php

namespace Database\Factories;

use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<User>
 */
class UserFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'id' => (string) Str::uuid(),
            'full_name' => fake()->name(),
            'phone' => fake()->unique()->numerify('+2010########'),
            'email' => fake()->unique()->safeEmail(),
            'is_active' => true,
        ];
    }
}
